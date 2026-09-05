import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: async (k: string) => store.get(k),
    setItem: async (k: string, v: string) => void store.set(k, v),
  },
}));

const { Creativity } = await import("../src/lib/enums");
const { listCustomCommands, saveCustomCommand, deleteCustomCommand, validateCustomCommand } =
  await import("../src/lib/custom/storage");

describe("custom command storage", () => {
  beforeEach(() => store.clear());

  it("round-trips a command", async () => {
    await saveCustomCommand({ id: "1", name: "Rot", prompt: "Do {selection}", creativity: Creativity.Low });
    expect((await listCustomCommands()).map((c) => c.name)).toEqual(["Rot"]);
  });

  it("deletes by id", async () => {
    await saveCustomCommand({ id: "1", name: "Rot", prompt: "Do {selection}", creativity: Creativity.Low });
    await deleteCustomCommand("1");
    expect(await listCustomCommands()).toEqual([]);
  });

  it("replaces rather than duplicates when the same id is saved twice", async () => {
    await saveCustomCommand({ id: "1", name: "First", prompt: "{selection}", creativity: Creativity.Low });
    await saveCustomCommand({ id: "1", name: "Second", prompt: "{selection}", creativity: Creativity.Low });
    const all = await listCustomCommands();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Second");
  });

  it("keeps a per-command model through a round trip", async () => {
    await saveCustomCommand({
      id: "1",
      name: "Rot",
      prompt: "{selection}",
      model: "deepseek-chat",
      creativity: Creativity.Low,
    });
    expect((await listCustomCommands())[0].model).toBe("deepseek-chat");
  });

  it("survives a corrupted store", async () => {
    store.set("custom:commands", "{not json");
    expect(await listCustomCommands()).toEqual([]);
  });
});

describe("validateCustomCommand", () => {
  it("rejects an empty name", () => {
    expect(validateCustomCommand({ name: "", prompt: "{selection}" })).toMatch(/name/i);
  });

  it("rejects a whitespace-only name", () => {
    expect(validateCustomCommand({ name: "   ", prompt: "{selection}" })).toMatch(/name/i);
  });

  it("rejects a prompt with no placeholder", () => {
    expect(validateCustomCommand({ name: "X", prompt: "no placeholder" })).toMatch(/selection/i);
  });

  // Without {selection} the command runs, sends the prompt with the user's text
  // nowhere in it, and returns a confident answer to a question nobody asked.
  it("rejects a prompt whose placeholder is misspelled", () => {
    expect(validateCustomCommand({ name: "X", prompt: "Do {selected}" })).toMatch(/selection/i);
  });

  it("accepts a valid draft", () => {
    expect(validateCustomCommand({ name: "X", prompt: "Do {selection}" })).toBeUndefined();
  });
});
