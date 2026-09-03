//! SPEC-280 "Open for Jim" — the http plugin's scope, matched by the plugin's
//! own matcher, not Node's.
//!
//! `capabilities.test.ts` checks the committed allow list with Node's
//! `URLPattern`; the plugin matches with the `urlpattern` crate. Both are the
//! WHATWG algorithm, but only this test runs the crate the shipped binary
//! runs. It rebuilds each allow entry exactly as
//! `tauri-plugin-http-2.6.0/src/scope.rs` does — parse the constructor
//! string, then default an empty search, hash and pathname (or `/`) to `*` —
//! and asserts the same URL table the TypeScript test asserts, positive and
//! negative, for both capability files.
//!
//! `urlpattern` is a dev-dependency only (Jim, 2026-09-03), the version the
//! plugin already pulls, so the graph gains nothing.

#[cfg(test)]
mod tests {
    use urlpattern::quirks::{process_construct_pattern_input, process_match_input, StringOrInit};
    use urlpattern::UrlPattern;

    /// `parse_url_pattern` from the plugin's `scope.rs`, line for line.
    fn plugin_pattern(s: &str) -> UrlPattern {
        let mut init = process_construct_pattern_input(StringOrInit::String(s.to_string()), None)
            .unwrap_or_else(|e| panic!("`{s}` is not a valid URL pattern: {e}"));
        if init.search.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
            init.search.replace("*".to_string());
        }
        if init.hash.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
            init.hash.replace("*".to_string());
        }
        if init
            .pathname
            .as_ref()
            .map(|p| p.is_empty() || p == "/")
            .unwrap_or(true)
        {
            init.pathname.replace("*".to_string());
        }
        UrlPattern::parse(init, Default::default()).expect("the plugin would have parsed it")
    }

    /// The `http:default` allow URLs of one committed capability file.
    fn allow_urls(file: &str) -> Vec<String> {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/");
        let text = std::fs::read_to_string(format!("{path}{file}")).expect("capability file");
        let json: serde_json::Value = serde_json::from_str(&text).expect("valid JSON");
        let perms = json["permissions"].as_array().expect("permissions array");
        let http = perms
            .iter()
            .find(|p| p["identifier"] == "http:default")
            .expect("an http:default entry");
        http["allow"]
            .as_array()
            .expect("allow array")
            .iter()
            .map(|a| a["url"].as_str().expect("url string").to_string())
            .collect()
    }

    fn matcher(file: &str) -> impl Fn(&str) -> bool {
        let patterns: Vec<UrlPattern> =
            allow_urls(file).iter().map(|u| plugin_pattern(u)).collect();
        move |url: &str| {
            let (input, _) = process_match_input(StringOrInit::String(url.to_string()), None)
                .expect("a well-formed URL")
                .expect("a URL the matcher can process");
            patterns
                .iter()
                .any(|p| p.test(input.clone()).unwrap_or(false))
        }
    }

    const FILES: [&str; 2] = ["main.json", "content.json"];

    #[test]
    fn the_allow_list_is_exactly_the_intended_one_in_both_files() {
        let expected = [
            "http://*",
            "http://*/*",
            "http://127.0.0.1:*",
            "http://127.0.0.1:*/*",
            "http://localhost:*",
            "http://localhost:*/*",
            "https://*",
            "https://*/*",
        ];
        for file in FILES {
            assert_eq!(allow_urls(file), expected, "{file}");
            assert!(
                !allow_urls(file).iter().any(|u| u.contains("*:*")),
                "{file}: no *:* entry"
            );
        }
    }

    #[test]
    fn reaches_a_local_model_server_on_its_port() {
        for file in FILES {
            let allowed = matcher(file);
            for url in [
                "http://127.0.0.1:11434/v1/chat/completions",
                "http://localhost:11434/api/tags",
                "http://localhost:1234/v1/models",
                "http://127.0.0.1:8080/",
                "http://127.0.0.1:11434",
                "http://127.0.0.1:11434/v1/chat/completions?stream=false",
                "http://example.com/x",
                "https://api.openai.com/v1/chat/completions",
            ] {
                assert!(allowed(url), "{file}: {url} should be allowed");
            }
        }
    }

    #[test]
    fn does_not_widen_plain_http_to_other_hosts_on_other_ports() {
        for file in FILES {
            let allowed = matcher(file);
            for url in [
                "http://evil.example:8080/x",
                "http://10.0.0.5:11434/v1/models",
                "http://localhost.evil.com:11434/v1/models",
                "http://127.0.0.1.nip.io:11434/v1/models",
                "http://192.168.1.1:8080/api",
                "http://169.254.169.254:8080/latest/meta-data",
                "http://evil.example:1234/v1/models",
                "http://example.com:11434/v1/models",
                "http://0.0.0.0:11434/v1/models",
                "http://127.0.0.2:11434/",
                "http://169.254.169.254:11434/",
                "http://[::ffff:127.0.0.1]:11434/v1/models",
                "http://[::1]:11434/v1/models",
            ] {
                assert!(!allowed(url), "{file}: {url} must be refused");
            }
        }
    }
}
