import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: async (k: string) => store.get(k),
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  },
}));

const {
  listConversations,
  saveConversation,
  deleteConversation,
  windowMessages,
  parseHistoryLimit,
  conversationTitle,
} = await import("../src/lib/chat/history");

describe("chat history", () => {
  beforeEach(() => store.clear());

  it("starts empty", async () => {
    expect(await listConversations()).toEqual([]);
  });

  it("round-trips a conversation", async () => {
    await saveConversation({ id: "a", title: "T", model: "m", messages: [], updatedAt: 1 });
    expect((await listConversations()).map((c) => c.id)).toEqual(["a"]);
  });

  it("sorts most-recently-updated first", async () => {
    await saveConversation({ id: "old", title: "o", model: "m", messages: [], updatedAt: 1 });
    await saveConversation({ id: "new", title: "n", model: "m", messages: [], updatedAt: 2 });
    expect((await listConversations()).map((c) => c.id)).toEqual(["new", "old"]);
  });

  it("replaces rather than duplicates on re-save", async () => {
    await saveConversation({ id: "a", title: "first", model: "m", messages: [], updatedAt: 1 });
    await saveConversation({ id: "a", title: "second", model: "m", messages: [], updatedAt: 2 });
    const all = await listConversations();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("second");
  });

  it("deletes by id", async () => {
    await saveConversation({ id: "a", title: "T", model: "m", messages: [], updatedAt: 1 });
    await deleteConversation("a");
    expect(await listConversations()).toEqual([]);
  });

  // A corrupted store must not brick the chat command on every open. Losing the
  // history is bad; being unable to start a new conversation is worse.
  it("survives a corrupted store", async () => {
    store.set("chat:conversations", "{not json");
    expect(await listConversations()).toEqual([]);
  });

  it("survives a store holding valid JSON of the wrong shape", async () => {
    store.set("chat:conversations", '{"id":"a"}');
    expect(await listConversations()).toEqual([]);
  });
});

describe("windowMessages", () => {
  const msgs = Array.from({ length: 10 }, (_, i) => ({ role: "user" as const, content: String(i) }));

  it("keeps the most recent N", () => {
    expect(windowMessages(msgs, 3).map((m) => m.content)).toEqual(["7", "8", "9"]);
  });

  it("returns everything when under the limit", () => {
    expect(windowMessages(msgs, 50)).toHaveLength(10);
  });

  it("always preserves a leading system message", () => {
    const withSystem = [{ role: "system" as const, content: "sys" }, ...msgs];
    const out = windowMessages(withSystem, 3);
    expect(out[0].content).toBe("sys");
    expect(out).toHaveLength(4);
  });

  // The system message is the one instruction the model must never lose, and a
  // zero or negative limit is reachable from the user-editable preference.
  it("keeps the system message even at a limit of zero", () => {
    const withSystem = [{ role: "system" as const, content: "sys" }, ...msgs];
    expect(windowMessages(withSystem, 0)).toEqual([{ role: "system", content: "sys" }]);
  });

  it("does not treat a mid-conversation system message as leading", () => {
    const mid = [...msgs.slice(0, 2), { role: "system" as const, content: "sys" }, ...msgs.slice(2, 4)];
    expect(windowMessages(mid, 2).map((m) => m.content)).toEqual(["2", "3"]);
  });
});

describe("conversationTitle", () => {
  // The title labels the conversation in the history list, so it has to stay
  // the opening question: deriving it from the latest turn renames the
  // conversation on every message and makes the list unrecognisable.
  it("uses the first user message, not the most recent", () => {
    const title = conversationTitle([
      { role: "user", content: "How do I brine a turkey?" },
      { role: "assistant", content: "..." },
      { role: "user", content: "And the oven temperature?" },
    ]);
    expect(title).toBe("How do I brine a turkey?");
  });

  it("skips a leading system message", () => {
    expect(
      conversationTitle([
        { role: "system", content: "You are terse." },
        { role: "user", content: "Hello" },
      ]),
    ).toBe("Hello");
  });

  it("collapses newlines so the list row stays one line", () => {
    expect(conversationTitle([{ role: "user", content: "line one\nline two" }])).toBe("line one line two");
  });

  it("truncates a long opening message", () => {
    const title = conversationTitle([{ role: "user", content: "x".repeat(200) }]);
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("names an empty conversation rather than returning a blank row", () => {
    expect(conversationTitle([])).toBe("New conversation");
  });
});

describe("parseHistoryLimit", () => {
  it("honours a limit of zero as no history, not as unset", () => {
    // `Number(raw) || 20` reads 0 as falsy and substitutes 20, so a user who
    // asks for no context gets twenty messages of it.
    expect(parseHistoryLimit("0")).toBe(0);
  });

  it("falls back to 20 for blank, unset and unparseable values", () => {
    expect(parseHistoryLimit(undefined)).toBe(20);
    expect(parseHistoryLimit("")).toBe(20);
    expect(parseHistoryLimit("   ")).toBe(20);
    expect(parseHistoryLimit("lots")).toBe(20);
  });

  it("floors a negative limit rather than slicing from the front", () => {
    expect(parseHistoryLimit("-5")).toBe(0);
  });

  it("truncates a fractional limit to a whole number of messages", () => {
    expect(parseHistoryLimit("3.7")).toBe(3);
  });
});
