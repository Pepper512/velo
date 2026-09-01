# Exceptions Register

<!-- Deviations from the methodology that outlive the week (06-decisions.md).
     Every entry has an owner and an expiry. Expired + unrenewed = new work in
     that area is blocked until resolved. Two exceptions against the same rule
     means the rule is wrong — fix the rule, don't file a third. -->

| ID | Date | Rule bent | What & why | Risk | Mitigation | Expiry | Status |
|---|---|---|---|---|---|---|---|
| EX-001 | 2026-09-01 | `04-gates.md` baseline CI (all gates) | Fresh project — gates aren't wired yet, honor-system by necessity. | Nothing ships without review, since nothing ships yet. Activates at first commit. | Wire baseline CI as the first Tier-1+ task once code exists. | 2026-10-02 | **Closing** — resolved by `.github/workflows/ci.yml` (PR `chore/ci-baseline`); close on merge. Remaining unwired gates listed individually below. |
| EX-002 | 2026-09-01 | `04-gates.md` lint gate must be red-on-warning | `cargo clippy -D warnings` with three named allowances (`too_many_arguments`, `question_mark`, `unnecessary_map_or`) covering 3 pre-existing lints in `src-tauri`. Any new lint fails. | Debt stays invisible to CI. | Fix the three in Batch A (they are in files A already touches) and drop the allowances. | 2026-10-15 | Open |
| EX-003 | 2026-09-01 | `04-gates.md` dependency audit red on any advisory | `cargo audit --ignore RUSTSEC-2026-0141` (lettre: hostname verification disabled **with the Boring TLS backend**). Velo builds lettre with `tokio1-native-tls`; the vulnerable code path is not compiled. | None if the feature set is unchanged. | Re-check on every lettre bump; CI step fails if a different advisory appears. | 2026-12-01 | Open |
| EX-004 | 2026-09-01 | Vuln SLA — High reachable 7d | `npm audit --omit=dev --audit-level=critical` (not `high`) because `linkify-it`/`markdown-it` High via `@tiptap/pm` is deferred to Batch G per Jim's 2026-09-01 decision. Reachability: prosemirror-markdown is a transitive dep of `@tiptap/pm`; Velo does not call markdown parsing on untrusted input (to be confirmed in Batch G). | Quadratic-time DoS on attacker text if reachable. | Batch G bumps `@tiptap/*`; then raise the audit level to `high`. | 2026-10-15 | Open |
| EX-005 | 2026-09-01 | Branch protection — required approving reviews | `main` protection enables the required `ci` check, linear history, and blocks history rewrites, but **not** required approving reviews: the repo has one human; the PR author cannot approve their own PR, so the rule would block every merge or force admin bypass. | A merge could land without a second human. Mitigation: agents never merge; Jim is the only merger; opposite-line agent review is recorded in the PR. | Enable required reviews when a second maintainer exists. | 2027-03-01 | Open |
| EX-006 | 2026-09-01 | `04-gates.md` dependency audit red on any advisory | `cargo audit --ignore RUSTSEC-2026-0235 --ignore RUSTSEC-2023-0071`. `rkyv 0.7.46` and `rsa 0.9.10` appear in `Cargo.lock` but in **no resolved build graph** — `cargo tree --target all -e all` lists neither (they are unused optional-feature crates of transitive deps). Nothing vulnerable is compiled. | None while they stay out of the graph. | CI step fails if either crate enters the graph with the advisory still open (cargo audit re-flags); re-check on every `cargo update`. | 2026-12-01 | Open |

## Log of closures
