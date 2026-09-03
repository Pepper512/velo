#!/usr/bin/env node
// PR D REQ-2.2: after `vite build`, assert the bundle's shape the CSP relies on.
// - dist/index.html and dist/splashscreen.html exist
// - every <script> in either has a src (the CSP is script-src 'self': an inline
//   script would be blocked at runtime, silently, in the packaged app)
// - index.html references at least one hashed /assets/*.js and one hashed /assets/*.css
// Prints the dist file count and total size for the PR body. Exit 1 on any failure.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const dist = join(process.cwd(), "dist");
const failures = [];

function page(name) {
  const p = join(dist, name);
  if (!existsSync(p)) {
    failures.push(`${name} is missing`);
    return "";
  }
  return readFileSync(p, "utf8");
}

const index = page("index.html");
const splash = page("splashscreen.html");

for (const [name, html] of [["index.html", index], ["splashscreen.html", splash]]) {
  const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
  for (const tag of scripts) {
    if (!/\bsrc\s*=/.test(tag)) failures.push(`${name}: inline <script> found: ${tag}`);
  }
}

if (index && !/\/assets\/[^"']+-[A-Za-z0-9_-]{6,}\.js\b/.test(index)) {
  failures.push("index.html references no hashed /assets/*.js");
}
if (index && !/\/assets\/[^"']+-[A-Za-z0-9_-]{6,}\.css\b/.test(index)) {
  failures.push("index.html references no hashed /assets/*.css");
}

function walk(dir) {
  let count = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      const sub = walk(p);
      count += sub.count;
      bytes += sub.bytes;
    } else {
      count += 1;
      bytes += st.size;
    }
  }
  return { count, bytes };
}

if (existsSync(dist)) {
  const { count, bytes } = walk(dist);
  console.log(`dist: ${count} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`check-dist: ${f}`);
  process.exit(1);
}
console.log("check-dist: OK — pages present, no inline scripts, hashed assets referenced");
