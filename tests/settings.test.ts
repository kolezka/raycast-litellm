import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

const prefs = { defaultModel: "deepseek/deepseek-chat" as string | undefined };

vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: async (k: string) => store.get(k),
    setItem: async (k: string, v: string) => void store.set(k, v),
  },
  // A live reference, so a test can vary the preference rather than being stuck
  // with one fixed value — the empty-default contract below needs that.
  getPreferenceValues: () => prefs,
}));

const { CommandName } = await import("../src/lib/enums");
const { getCommandModel, resolveModel, setCommandModel } = await import("../src/lib/settings");

describe("settings", () => {
  beforeEach(() => store.clear());

  it("returns undefined when a command has no override", async () => {
    expect(await getCommandModel(CommandName.EXPLAIN)).toBeUndefined();
  });

  it("round-trips an override", async () => {
    await setCommandModel(CommandName.EXPLAIN, "gpt-4o");
    expect(await getCommandModel(CommandName.EXPLAIN)).toBe("gpt-4o");
  });

  it("keeps overrides independent per command", async () => {
    await setCommandModel(CommandName.EXPLAIN, "gpt-4o");
    expect(await getCommandModel(CommandName.TWEET)).toBeUndefined();
  });

  it("falls back to the default-model preference", async () => {
    expect(await resolveModel(CommandName.EXPLAIN)).toBe("deepseek/deepseek-chat");
  });

  it("prefers an override over the preference", async () => {
    await setCommandModel(CommandName.EXPLAIN, "gpt-4o");
    expect(await resolveModel(CommandName.EXPLAIN)).toBe("gpt-4o");
  });

  // The documented contract, and what Task 6's `|| available[0]?.id` depends on.
  // A truthy sentinel here would be sent to the proxy as a model name.
  it("returns an empty string when neither an override nor a preference is set", async () => {
    prefs.defaultModel = undefined;
    try {
      expect(await resolveModel(CommandName.EXPLAIN)).toBe("");
    } finally {
      prefs.defaultModel = "deepseek/deepseek-chat";
    }
  });
});
