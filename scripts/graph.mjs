#!/usr/bin/env node
/**
 * Import-graph checker for the layering rules in `docs/architecture.md`
 * (audit P13).
 *
 * The architecture doc's central claim is three layers — UI → services → native.
 * The audit measured the reality: **one strongly-connected component of 40 files
 * and 54 simple cycles**, all running through
 * `router/navigate → router/index → routeTree → App`, because
 * `services/emailActions.ts` imported the router. A Gmail delta sync therefore
 * transitively imported the entire page tree, and no service could be tested
 * without it.
 *
 * This script is the acceptance check for that item, and the regression guard
 * afterwards. It is dependency-free on purpose: adding `dependency-cruiser`
 * would need its own dependency decision, and the graph we care about is a few
 * dozen lines of `import` parsing.
 *
 * Usage:
 *   node scripts/graph.mjs            # report
 *   node scripts/graph.mjs --check    # exit 1 if a rule is violated
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const EXTS = [".ts", ".tsx"];

/** Every source file, excluding tests. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (
      EXTS.some((e) => entry.endsWith(e)) &&
      !entry.includes(".test.") &&
      !entry.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Resolve an import specifier to a file inside src/, or null if external. */
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;

  for (const candidate of [
    base,
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => join(base, "index" + e)),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g;

const files = walk(SRC);
/** @type {Map<string, string[]>} file -> imported files, all repo-relative */
const graph = new Map();

for (const file of files) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  const deps = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const target = resolveImport(m[1], file);
    if (target) deps.push(relative(ROOT, target));
  }
  graph.set(rel, deps);
}

// ---------------------------------------------------------------------------
// Tarjan's algorithm — strongly connected components
// ---------------------------------------------------------------------------
function stronglyConnectedComponents(g) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const comps = [];

  function strongConnect(v) {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of g.get(v) ?? []) {
      if (!idx.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), idx.get(w)));
      }
    }

    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) comps.push(comp);
    }
  }

  for (const v of g.keys()) if (!idx.has(v)) strongConnect(v);
  return comps;
}

const isService = (f) => f.startsWith("src/services/");
const isStore = (f) => f.startsWith("src/stores/");
const isDb = (f) => f.startsWith("src/services/db/");
const isComponentish = (f) =>
  f.startsWith("src/components/") || f.startsWith("src/hooks/");

const sccs = stronglyConnectedComponents(graph);
const cyclesWithService = sccs.filter((c) => c.some(isService));

const serviceToStore = [];
for (const [file, deps] of graph) {
  if (!isService(file)) continue;
  for (const d of deps) if (isStore(d)) serviceToStore.push(`${file} -> ${d}`);
}

const componentsImportingDb = new Set();
for (const [file, deps] of graph) {
  if (!isComponentish(file)) continue;
  if (deps.some(isDb)) componentsImportingDb.add(file);
}

console.log(`files: ${graph.size}`);
console.log(`edges: ${[...graph.values()].reduce((n, d) => n + d.length, 0)}`);
console.log(`strongly-connected components (size > 1): ${sccs.length}`);
console.log(`  ...containing a services/* file: ${cyclesWithService.length}`);
for (const c of cyclesWithService) {
  console.log(`  [${c.length} files] ${c.slice(0, 6).join(", ")}${c.length > 6 ? " …" : ""}`);
}
console.log(`services -> stores edges: ${serviceToStore.length}`);
for (const e of serviceToStore) console.log(`  ${e}`);
console.log(`components/hooks importing services/db/*: ${componentsImportingDb.size}`);

if (process.argv.includes("--check")) {
  // Only the cycle rule is enforced today. The services -> stores count and the
  // db-import count are tracked so each PR can report the trend (audit P13
  // acceptance), but they are pre-existing debt and would fail the build on
  // day one -- a gate nobody can turn green is a gate that gets deleted.
  if (cyclesWithService.length > 0) {
    console.error(
      `\nFAIL: ${cyclesWithService.length} import cycle(s) contain a services/* file.`,
    );
    process.exit(1);
  }
  console.log("\nOK: no import cycle contains a services/* file.");
}
