import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: async (k: string) => store.get(k),
    setItem: async (k: string, v: string) => void store.set(k, v),
  },
}));

const { appendAudit, listAudit } = await import("../src/lib/agent/audit");

describe("audit log", () => {
  beforeEach(() => store.clear());

  it("returns entries newest first", async () => {
    await appendAudit({ at: 1, tool: "a", arguments: "{}", decision: "allow", conversationId: "c1" });
    await appendAudit({ at: 2, tool: "b", arguments: "{}", decision: "ask", conversationId: "c1" });
    expect((await listAudit()).map((e) => e.tool)).toEqual(["b", "a"]);
  });

  it("caps at the most recent 200 entries", async () => {
    for (let i = 0; i < 205; i++) {
      await appendAudit({ at: i, tool: `t${i}`, arguments: "{}", decision: "allow", conversationId: "c1" });
    }
    const all = await listAudit();
    expect(all).toHaveLength(200);
    expect(all[0].tool).toBe("t204");
  });

  // I4 / the spec's own requirement: "tool, arguments, decision, timestamp,
  // conversation id". Without this field, entries from two concurrent (or
  // sequential) agent runs are indistinguishable in the log — this is what
  // AuditLog's "Conversation" detail line, and any future per-run filter,
  // depends on.
  it("carries the conversation id through, so an entry can be attributed to the run that produced it", async () => {
    await appendAudit({ at: 1, tool: "web_fetch", arguments: "{}", decision: "allow", conversationId: "agent-123" });
    const [entry] = await listAudit();
    expect(entry.conversationId).toBe("agent-123");
  });

  it("survives a corrupted store", async () => {
    store.set("agent:audit", "{not json");
    expect(await listAudit()).toEqual([]);
  });
});
