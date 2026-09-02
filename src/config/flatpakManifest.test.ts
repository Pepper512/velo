import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * SPEC-233 REQ-2.1 — the Flatpak pins live in four files that nothing ties
 * together; the runtime went end-of-life without any of them noticing. This
 * test is the tie: the manifest, the packaging workflow and the contributor
 * instructions must name the same runtime and Node extension, the extension's
 * major must be the Node the app requires, and the bundle must know where its
 * runtime comes from.
 */

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf-8");

const manifest = read("com.velomail.app.yml");
const workflow = read(".github/workflows/packaging.yml");
const contributing = read("CONTRIBUTING.md");
const architecture = read("docs/architecture.md");
const pkg = JSON.parse(read("package.json")) as { engines?: { node?: string } };

/** `runtime-version: "50"` → `50` */
function manifestRuntimeVersion(): string {
  const m = /^runtime-version:\s*["']?(\d+)["']?\s*$/m.exec(manifest);
  if (!m) throw new Error("manifest has no runtime-version");
  return m[1]!;
}

/** The entry under `sdk-extensions:` (not a comment elsewhere): `node24` */
function manifestNodeExtension(): string {
  const m = /^sdk-extensions:\s*\n\s*-\s*org\.freedesktop\.Sdk\.Extension\.(node\d+)\s*$/m.exec(manifest);
  if (!m) throw new Error("manifest has no Node SDK extension under sdk-extensions");
  return m[1]!;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("Flatpak pins agree (SPEC-233)", () => {
  const runtime = manifestRuntimeVersion();
  const node = manifestNodeExtension();

  it("targets a GNOME runtime Flathub still updates", () => {
    // 46 died 2025-04-17, 48 on 2026-03-24; 50 is current (Sept 2026). The
    // test cannot read Flathub's calendar — it pins the floor the spec chose.
    expect(Number(runtime)).toBeGreaterThanOrEqual(50);
  });

  it("the workflow installs the same Platform and Sdk as the manifest", () => {
    expect(workflow).toContain(`org.gnome.Platform/x86_64/${runtime}`);
    expect(workflow).toContain(`org.gnome.Sdk/x86_64/${runtime}`);
    // No other version anywhere in the workflow (dynamic: a future bump must not
    // trip on the number the test was written with — #233 review, Gemini L2).
    expect(workflow).not.toMatch(new RegExp(`org\\.gnome\\.(Platform|Sdk)/x86_64/(?!${escape(runtime)}\\b)\\d+`));
  });

  it("the Node extension is the Node the app requires, on the runtime's base", () => {
    const floor = /(\d+)/.exec(pkg.engines?.node ?? "")?.[1];
    expect(floor, "package.json engines.node").toBeDefined();
    expect(node).toBe(`node${floor}`);
    // GNOME 49 and 50 are built on freedesktop-sdk 25.08; the extension branch follows the base.
    expect(workflow).toContain(`org.freedesktop.Sdk.Extension.${node}/x86_64/25.08`);
    expect(workflow).not.toMatch(new RegExp(`Extension\\.node(?!${escape(floor!)}\\b)\\d+`));
    expect(manifest).toContain(`append-path: /usr/lib/sdk/${node}/bin`);
  });

  it("the bundle knows where its runtime comes from (REQ-1.3)", () => {
    expect(workflow).toMatch(
      /flatpak build-bundle .*--runtime-repo=https:\/\/flathub\.org\/repo\/flathub\.flatpakrepo/,
    );
  });

  it("the packaging job can be dispatched on a branch, and uploads only for a tag (REQ-2.2)", () => {
    expect(workflow).toMatch(/^\s*workflow_dispatch:/m);
    // The exact gate, not "mentions tag_name" (#233 review, Gemini M1): a tag
    // must be given, AND the run must be the release workflow or a dispatch from
    // that tag's own ref — a branch dispatch naming a shipped tag may not upload.
    const GATE = /if:\s*\$\{\{\s*inputs\.tag_name\s*!=\s*''\s*&&\s*\(github\.event_name\s*==\s*'workflow_call'\s*\|\|\s*github\.ref\s*==\s*format\('refs\/tags\/\{0\}',\s*inputs\.tag_name\)\)\s*\}\}/;
    // Every step that uploads to a release carries the gate. No `m` flag on the
    // capture: `$` must mean end of file, or the lazy capture stops at a line break.
    const uploadSteps = [...workflow.matchAll(/- name: (Upload [^\n]+ to release)\n([\s\S]*?)(?:\n\s*- name:|\n\s*[a-z-]+:\n\s+name:|$)/g)];
    expect(uploadSteps.map((m) => m[1])).toEqual(["Upload Flatpak to release", "Upload SRPM to release"]);
    for (const step of uploadSteps) {
      expect(step[2], step[1]).toMatch(GATE);
      expect(step[2], step[1]).toContain("gh release upload");
    }
  });

  it("the contributor and architecture docs say the same runtime and extension", () => {
    expect(contributing).toContain(`org.gnome.Platform/x86_64/${runtime}`);
    expect(contributing).toContain(`org.gnome.Sdk/x86_64/${runtime}`);
    expect(contributing).toContain(`org.freedesktop.Sdk.Extension.${node}/x86_64/25.08`);
    expect(contributing).not.toMatch(/GNOME 4\d SDK/);
    expect(architecture).toContain(`GNOME ${runtime} runtime`);
  });
});
