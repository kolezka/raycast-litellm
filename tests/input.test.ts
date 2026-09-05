import { beforeEach, describe, expect, it, vi } from "vitest";

const prefs = { resultViewInput: "selectedText", resultViewInputFallback: false };
const selected = { value: "", throws: undefined as Error | undefined };
const clip = { value: "" };

vi.mock("@raycast/api", () => ({
  getPreferenceValues: () => prefs,
  getSelectedText: async () => {
    if (selected.throws) throw selected.throws;
    return selected.value;
  },
  Clipboard: { readText: async () => clip.value },
}));

const { getCommandInput } = await import("../src/lib/ui/input");

describe("getCommandInput", () => {
  beforeEach(() => {
    prefs.resultViewInput = "selectedText";
    prefs.resultViewInputFallback = false;
    selected.value = "";
    selected.throws = undefined;
    clip.value = "";
  });

  it("reads the selection when that is the preferred source", async () => {
    selected.value = "picked";
    clip.value = "clipboard";
    expect(await getCommandInput()).toBe("picked");
  });

  it("reads the clipboard when that is the preferred source", async () => {
    prefs.resultViewInput = "clipboard";
    selected.value = "picked";
    clip.value = "clipboard";
    expect(await getCommandInput()).toBe("clipboard");
  });

  it("falls back to the other source only when fallback is enabled", async () => {
    clip.value = "clipboard";
    prefs.resultViewInputFallback = true;
    expect(await getCommandInput()).toBe("clipboard");
  });

  it("falls back to the selection when the clipboard is the preferred source", async () => {
    prefs.resultViewInput = "clipboard";
    prefs.resultViewInputFallback = true;
    selected.value = "from selection";
    clip.value = "";
    expect(await getCommandInput()).toBe("from selection");
  });

  it("throws when fallback is enabled but both sources are empty", async () => {
    prefs.resultViewInputFallback = true;
    await expect(getCommandInput()).rejects.toThrow("No text selected");
  });

  it("throws rather than reading the other source when fallback is disabled", async () => {
    clip.value = "clipboard";
    await expect(getCommandInput()).rejects.toThrow("No text selected");
  });

  it("treats a whitespace-only primary as empty", async () => {
    selected.value = "   \n  ";
    clip.value = "clipboard";
    prefs.resultViewInputFallback = true;
    expect(await getCommandInput()).toBe("clipboard");
  });

  it("names the configured source in the error", async () => {
    prefs.resultViewInput = "clipboard";
    await expect(getCommandInput()).rejects.toThrow("Clipboard is empty");
  });

  it("includes the underlying selection error when no input can be found", async () => {
    selected.throws = new Error("Operation not permitted");
    await expect(getCommandInput()).rejects.toThrow(/No text selected \(Operation not permitted\)/);
  });

  it("still falls back to the clipboard when reading the selection throws", async () => {
    selected.throws = new Error("anything at all");
    clip.value = "from clipboard";
    prefs.resultViewInputFallback = true;
    expect(await getCommandInput()).toBe("from clipboard");
  });
});
