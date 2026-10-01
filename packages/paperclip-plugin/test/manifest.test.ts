import { describe, expect, it } from "vitest";
import manifest, { TOOL_CHECK, TOOL_REPORT } from "../src/manifest.js";

// Paperclip catalogs agent tools from manifest.tools only. A worker that registers
// a tool the manifest does not declare is invisible to agents (0.1.2 shipped that way).
describe("paperclip manifest", () => {
  it("declares both tools the worker registers", () => {
    const names = (manifest.tools ?? []).map((t) => t.name);
    expect(names).toEqual([TOOL_CHECK, TOOL_REPORT]);
  });
  it("declares the capability tools require", () => {
    expect(manifest.capabilities).toContain("agent.tools.register");
  });
  it("gives every tool a schema with required fields", () => {
    for (const t of manifest.tools ?? []) {
      expect(t.displayName).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(20);
      expect((t.parametersSchema as { required?: string[] }).required?.length).toBeGreaterThan(0);
    }
  });
  it("keeps manifest and package versions in sync", async () => {
    const pkg = await import("../package.json", { with: { type: "json" } });
    expect(manifest.version).toBe(pkg.default.version);
  });
});
