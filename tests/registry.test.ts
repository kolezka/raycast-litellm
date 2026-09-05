import { describe, expect, it, vi } from "vitest";

vi.mock("@raycast/api", () => ({
  Clipboard: { readText: async () => "clip", read: async () => ({}) },
  getSelectedText: async () => "selection",
  BrowserExtension: { getContent: async () => "page" },
}));

const { ALL_TOOLS, toolDefinitions, findTool, filterTools } = await import("../src/lib/agent/registry");

describe("registry", () => {
  it("gives every tool a name, description and object schema", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.definition.name, "name").toBeTruthy();
      expect(tool.definition.description.length, `${tool.definition.name} description`).toBeGreaterThan(10);
      expect(tool.definition.parameters.type, `${tool.definition.name} schema`).toBe("object");
    }
  });

  it("has no duplicate tool names", () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // The taint flag drives the permission override. A tool returning outside
  // content without it is the failure that makes the whole rule pointless.
  it("marks every tool that returns content we did not author as tainting", () => {
    const shouldTaint = [
      "web_search",
      "web_fetch",
      "read_clipboard",
      "read_selection",
      "read_browser_tab",
      "read_file",
      "run_shell",
    ];
    for (const name of shouldTaint) {
      expect(findTool(ALL_TOOLS, name)?.taints, name).toBe(true);
    }
  });

  it("finds a tool by name and returns undefined for an unknown one", () => {
    expect(findTool(ALL_TOOLS, "web_fetch")?.definition.name).toBe("web_fetch");
    expect(findTool(ALL_TOOLS, "rm_rf")).toBeUndefined();
  });

  it("filters to an allowlist, dropping everything else", () => {
    const filtered = filterTools(ALL_TOOLS, ["web_fetch"]);
    expect(filtered.map((t) => t.definition.name)).toEqual(["web_fetch"]);
  });

  it("builds definitions the model can be sent", () => {
    const defs = toolDefinitions(filterTools(ALL_TOOLS, ["web_fetch"]));
    expect(defs).toEqual([
      expect.objectContaining({ name: "web_fetch", parameters: expect.objectContaining({ type: "object" }) }),
    ]);
  });
});
