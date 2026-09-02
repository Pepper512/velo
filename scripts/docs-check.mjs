#!/usr/bin/env node
/**
 * Verify the hand-written counts in the docs against the tree (audit P20).
 *
 * The audit found six drifted numbers — `docs/architecture.md` claiming 34
 * tables in one place and 35 in another, "19 migrations" against an actual 23,
 * "8 Zustand stores" in prose against 9 in the table below it, and a provider
 * list two providers short.
 *
 * Correcting them once would have been worth roughly nothing: they drift because
 * a human maintains them by hand, and every batch since has moved at least one.
 * So the fix the audit actually asks for is this script — the counts get checked
 * by CI, and when one is wrong the failure names the file, the claim, and the
 * real number.
 *
 * Dependency-free on purpose: `knip` or similar would need its own dependency
 * decision, and this is arithmetic over a file tree.
 *
 * Usage:
 *   node scripts/docs-check.mjs           # report
 *   node scripts/docs-check.mjs --check   # exit 1 on any mismatch
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(ROOT, full));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ground truth, computed from the tree
// ---------------------------------------------------------------------------
const migrationsSrc = read("src/services/db/migrations.ts");

/** Migration count: entries in the MIGRATIONS array, i.e. `version: N,` rows. */
const migrationCount = [...migrationsSrc.matchAll(/^\s*version:\s*(\d+),/gm)].length;

/** Highest migration version, which must equal the count if none are skipped. */
const maxMigrationVersion = Math.max(
  ...[...migrationsSrc.matchAll(/^\s*version:\s*(\d+),/gm)].map((m) => Number(m[1])),
);

/** Tables created anywhere in the migrations, `_migrations` included. */
const tableCount = new Set(
  [...migrationsSrc.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map((m) => m[1]),
).size;

const srcFiles = walk(join(ROOT, "src"));
const isTest = (f) => f.includes(".test.");

const testFileCount = srcFiles.filter(
  (f) => isTest(f) && (f.endsWith(".ts") || f.endsWith(".tsx")),
).length;

/**
 * Test files by top-level `src/` directory — the "across stores (9), services
 * (83), …" breakdown that sits beside the total in two docs. The total was
 * gated from the start; the breakdown was not, and on 2026-09-02 the two docs
 * disagreed with each other and with the tree by up to twelve files while the
 * gated total passed. Same rule as the total: measured here, never typed.
 */
const testFilesByDir = {};
for (const f of srcFiles) {
  if (!isTest(f) || !(f.endsWith(".ts") || f.endsWith(".tsx"))) continue;
  const dir = f.split("/")[1];
  testFilesByDir[dir] = (testFilesByDir[dir] ?? 0) + 1;
}

const storeCount = srcFiles.filter(
  (f) => f.startsWith("src/stores/") && f.endsWith(".ts") && !isTest(f),
).length;

/**
 * AI providers: files in `services/ai/providers/` that are actual providers.
 * `openAiCompatible.ts` is the shared body extracted in P16(3), not a provider.
 */
const providerCount = srcFiles.filter(
  (f) =>
    f.startsWith("src/services/ai/providers/") &&
    f.endsWith("Provider.ts") &&
    !isTest(f),
).length;

const facts = {
  migrations: migrationCount,
  tables: tableCount,
  testFiles: testFileCount,
  stores: storeCount,
  aiProviders: providerCount,
};

// ---------------------------------------------------------------------------
// Claims, as they appear in the docs
// ---------------------------------------------------------------------------
/**
 * Each check names the file, a regex whose first capture group is the claimed
 * number, and the fact it must equal. A claim that no longer matches its regex
 * is reported too — silently skipping it is how these drifted in the first place.
 */
const CHECKS = [
  { file: "docs/architecture.md", label: "migrations", re: /(\d+)\s+migrations/g, fact: "migrations" },
  { file: "docs/architecture.md", label: "tables", re: /(\d+)\s+tables/g, fact: "tables" },
  { file: "CLAUDE.md", label: "migrations", re: /(\d+)\s+migrations/g, fact: "migrations" },
  { file: "CLAUDE.md", label: "test files", re: /(\d+)\s+test files/g, fact: "testFiles" },
  { file: "docs/development.md", label: "test files", re: /(\d+)\s+test files/g, fact: "testFiles" },
];

const failures = [];

console.log("Measured from the tree:");
for (const [k, v] of Object.entries(facts)) console.log(`  ${k}: ${v}`);

if (migrationCount !== maxMigrationVersion) {
  failures.push(
    `migrations: ${migrationCount} entries but highest version is ${maxMigrationVersion} — a version is skipped or duplicated`,
  );
}

console.log("\nClaims in docs:");
for (const { file, label, re, fact } of CHECKS) {
  if (!existsSync(join(ROOT, file))) continue;
  const text = read(file);
  const matches = [...text.matchAll(re)];

  if (matches.length === 0) {
    console.log(`  ${file}: no "${label}" claim found (ok — nothing to drift)`);
    continue;
  }

  for (const m of matches) {
    const claimed = Number(m[1]);
    const actual = facts[fact];
    const ok = claimed === actual;
    console.log(`  ${file}: "${m[0]}" -> ${ok ? "ok" : `WRONG, actual ${actual}`}`);
    if (!ok) {
      failures.push(`${file}: claims "${m[0]}" but the tree has ${actual}`);
    }
  }
}

/**
 * The per-directory breakdown: `N test files across a (x), b (y), …`. Every
 * `name (count)` pair must match the tree, and every directory that holds a
 * test file must appear — an omitted directory is how "153 across …" summed to
 * 129 for a whole day without anyone noticing.
 */
const BREAKDOWN_FILES = ["CLAUDE.md", "docs/development.md"];
const expectedBreakdown = Object.entries(testFilesByDir)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([dir, n]) => `${dir} (${n})`)
  .join(", ");

console.log("\nTest-file breakdown in docs:");
for (const file of BREAKDOWN_FILES) {
  if (!existsSync(join(ROOT, file))) continue;
  const line = read(file).match(/\d+ test files across ([^\n]+)/);
  if (!line) {
    console.log(`  ${file}: no breakdown claim found (ok — nothing to drift)`);
    continue;
  }

  const claimed = {};
  for (const m of line[1].matchAll(/([a-z]+) \((\d+)\)/g)) claimed[m[1]] = Number(m[2]);

  const problems = [];
  for (const [dir, n] of Object.entries(testFilesByDir)) {
    if (!(dir in claimed)) problems.push(`omits ${dir} (${n})`);
    else if (claimed[dir] !== n) problems.push(`${dir} claimed ${claimed[dir]}, actual ${n}`);
  }
  for (const dir of Object.keys(claimed)) {
    if (!(dir in testFilesByDir)) problems.push(`claims ${dir}, which holds no test files`);
  }

  console.log(`  ${file}: ${problems.length === 0 ? "ok" : `WRONG — ${problems.join("; ")}`}`);
  if (problems.length > 0) {
    failures.push(`${file}: test-file breakdown ${problems.join("; ")}. Expected: "${expectedBreakdown}"`);
  }
}

if (process.argv.includes("--check")) {
  if (failures.length > 0) {
    console.error(`\nFAIL: ${failures.length} documentation count(s) out of date:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "\nUpdate the number in the doc, or delete the count and point at the source.",
    );
    process.exit(1);
  }
  console.log("\nOK: documentation counts match the tree.");
}
