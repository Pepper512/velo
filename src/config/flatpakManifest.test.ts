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

/** `- org.freedesktop.Sdk.Extension.node24` → `node24` */
function manifestNodeExtension(): string {
  const m = /org\.freedesktop\.Sdk\.Extension\.(node\d+)/.exec(manifest);
  if (!m) throw new Error("manifest names no Node SDK extension");
  return m[1]!;
}

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
    expect(workflow).not.toMatch(/org\.gnome\.(Platform|Sdk)\/x86_64\/(?!50\b)\d+/);
  });

  it("the Node extension is the Node the app requires, on the runtime's base", () => {
    const floor = /(\d+)/.exec(pkg.engines?.node ?? "")?.[1];
    expect(floor, "package.json engines.node").toBeDefined();
    expect(node).toBe(`node${floor}`);
    // GNOME 49 and 50 are built on freedesktop-sdk 25.08; the extension branch follows the base.
    expect(workflow).toContain(`org.freedesktop.Sdk.Extension.${node}/x86_64/25.08`);
    expect(workflow).not.toMatch(/Extension\.node(?!24\b)\d+/);
    expect(manifest).toContain(`append-path: /usr/lib/sdk/${node}/bin`);
  });

  it("the bundle knows where its runtime comes from (REQ-1.3)", () => {
    expect(workflow).toMatch(
      /flatpak build-bundle .*--runtime-repo=https:\/\/flathub\.org\/repo\/flathub\.flatpakrepo/,
    );
  });

  it("the packaging job can be dispatched on a branch, and uploads only for a tag (REQ-2.2)", () => {
    expect(workflow).toMatch(/^\s*workflow_dispatch:/m);
    const upload = /- name: Upload Flatpak to release\n([\s\S]*?)\n\s*- name:|- name: Upload Flatpak to release\n([\s\S]*?)$/m.exec(workflow);
    const uploadStep = (upload?.[1] ?? upload?.[2] ?? "");
    expect(uploadStep).toMatch(/if:\s*.*inputs\.tag_name/);
  });

  it("the contributor and architecture docs say the same runtime and extension", () => {
    expect(contributing).toContain(`org.gnome.Platform/x86_64/${runtime}`);
    expect(contributing).toContain(`org.gnome.Sdk/x86_64/${runtime}`);
    expect(contributing).toContain(`org.freedesktop.Sdk.Extension.${node}/x86_64/25.08`);
    expect(contributing).not.toMatch(/GNOME 4\d SDK/);
    expect(architecture).toContain(`GNOME ${runtime} runtime`);
  });
});
