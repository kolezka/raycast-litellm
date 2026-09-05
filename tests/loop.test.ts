import { describe, expect, it } from "vitest";
import { AgentStep, runAgent, tookOutsideContent } from "../src/lib/agent/loop";
import { Tool } from "../src/lib/agent/types";
import { AssistantMessage, ChatRequest, LiteLLMClient } from "../src/lib/litellm/types";

/** A client that replays scripted replies, recording what it was asked. */
function fakeClient(replies: AssistantMessage[]): LiteLLMClient & { seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  return {
    seen,
    async complete(request) {
      seen.push(request);
      return replies.shift() ?? { content: "done", reasoning: "", toolCalls: [] };
    },
    async *chat() {},
    async listChatModels() {
      return [];
    },
  } as LiteLLMClient & { seen: ChatRequest[] };
}

const echo: Tool = {
  risk: "read",
  taints: false,
  definition: { name: "echo", description: "Echo the input back", parameters: { type: "object", properties: {} } },
  async run(input) {
    return `echoed:${input.value}`;
  },
};

const boom: Tool = {
  risk: "read",
  taints: false,
  definition: { name: "boom", description: "Always fails", parameters: { type: "object", properties: {} } },
  async run() {
    throw new Error("tool exploded");
  },
};

const blank: Tool = {
  risk: "read",
  taints: false,
  definition: { name: "blank", description: "Returns nothing", parameters: { type: "object", properties: {} } },
  async run() {
    return "";
  },
};

// A tool whose failure message can carry outside content — the real case
// this guards is web_fetch embedding a redirect Location or a response
// header, or run_shell embedding stderr, in the message it throws.
const taintingBoom: Tool = {
  risk: "read_remote",
  taints: true,
  definition: {
    name: "taintingBoom",
    description: "Throws attacker-influenced text",
    parameters: { type: "object", properties: {} },
  },
  async run() {
    throw new Error("attacker-controlled text from a 404 page");
  },
};

const say = (content: string): AssistantMessage => ({ content, reasoning: "", toolCalls: [] });
const call = (name: string, args: string): AssistantMessage => ({
  content: "",
  reasoning: "",
  toolCalls: [{ id: "c1", name, arguments: args }],
});

async function collect(gen: AsyncGenerator<unknown>) {
  const out = [];
  for await (const step of gen) out.push(step);
  return out;
}

const base = {
  model: "m",
  messages: [{ role: "user" as const, content: "go" }],
  maxIterations: 5,
  permit: async () => "allow" as const,
};

describe("runAgent", () => {
  it("returns the answer when no tools are requested", async () => {
    const steps = await collect(runAgent({ ...base, client: fakeClient([say("hello")]), tools: [] }));
    expect(steps).toEqual([{ kind: "assistant", text: "hello" }]);
  });

  it("runs a tool, feeds the result back, then answers", async () => {
    const client = fakeClient([call("echo", '{"value":"hi"}'), say("all done")]);
    const steps = await collect(runAgent({ ...base, client, tools: [echo] }));
    expect(steps.map((s: any) => s.kind)).toEqual(["tool_call", "tool_result", "assistant"]);
    expect((steps[1] as any).text).toBe("echoed:hi");
    // The second request must carry the tool result, or the model answers blind.
    const followUp = client.seen[1].messages;
    expect(followUp.at(-1)).toMatchObject({ role: "tool", content: "echoed:hi", toolCallId: "c1" });
  });

  // Models invent tool names. Throwing would end the run; telling the model lets
  // it correct itself.
  it("reports an unknown tool back to the model instead of throwing", async () => {
    const client = fakeClient([call("nope", "{}"), say("recovered")]);
    const steps = await collect(runAgent({ ...base, client, tools: [echo] }));
    expect((steps[1] as any).text).toMatch(/unknown tool/i);
    expect(steps.at(-1)).toEqual({ kind: "assistant", text: "recovered" });
  });

  it("reports malformed arguments back to the model instead of throwing", async () => {
    const client = fakeClient([call("echo", "{not json"), say("recovered")]);
    const steps = await collect(runAgent({ ...base, client, tools: [echo] }));
    expect((steps[1] as any).text).toMatch(/arguments/i);
  });

  // Some function-calling implementations emit "null" for a no-parameter call.
  // JSON.parse succeeds, but the result is not an arguments object, so it must
  // be reported the same way unparseable JSON is, not silently treated as "no
  // arguments" and passed to permit()/run() as undefined.
  it("reports non-object arguments (valid JSON, not an object) back to the model", async () => {
    const client = fakeClient([call("echo", "null"), say("recovered")]);
    const steps = await collect(runAgent({ ...base, client, tools: [echo] }));
    expect((steps[1] as any).text).toMatch(/arguments/i);
    expect(steps.at(-1)).toEqual({ kind: "assistant", text: "recovered" });
  });

  it("reports a failing tool back to the model", async () => {
    const client = fakeClient([call("boom", "{}"), say("moving on")]);
    const steps = await collect(runAgent({ ...base, client, tools: [boom] }));
    expect((steps[1] as any).text).toMatch(/tool exploded/);
    expect(steps.at(-1)).toEqual({ kind: "assistant", text: "moving on" });
  });

  it("does not run a denied tool, and says so to the model", async () => {
    const client = fakeClient([call("echo", '{"value":"hi"}'), say("fine")]);
    const steps = await collect(runAgent({ ...base, client, tools: [echo], permit: async () => "deny" as const }));
    expect((steps[1] as any).decision).toBe("denied");
    expect((steps[1] as any).text).toMatch(/denied/i);
    expect(client.seen[1].messages.at(-1)).toMatchObject({ role: "tool" });
  });

  // The caller (AgentView) uses `failed` to tell an actual return apart from a
  // failure when deciding whether a taints:true tool's content ever really
  // entered the conversation — a thrown error must not be treated as a return.
  it("marks a tool_result failed when the tool throws, and not failed when it succeeds", async () => {
    const failing = fakeClient([call("boom", "{}"), say("moving on")]);
    const failingSteps = await collect(runAgent({ ...base, client: failing, tools: [boom] }));
    expect((failingSteps[1] as any).failed).toBe(true);

    const succeeding = fakeClient([call("echo", '{"value":"hi"}'), say("all done")]);
    const succeedingSteps = await collect(runAgent({ ...base, client: succeeding, tools: [echo] }));
    expect((succeedingSteps[1] as any).failed).toBe(false);
  });

  // C1: `failed` alone used to gate taint, so a failing taints:true tool
  // (e.g. web_fetch's HTTP-status error embedding a redirect Location it
  // followed, or run_shell's stderr) never tainted the session — a clean
  // read_remote call right after it was then auto-allowed with no dialog.
  // `ran` — true the instant run() is entered, independent of throw/return —
  // is what taint must key off instead, via tookOutsideContent.
  describe("ran / tookOutsideContent — taint must survive a throw", () => {
    it("marks ran true when a taints:true tool throws, so the throw still taints", async () => {
      const client = fakeClient([call("taintingBoom", "{}"), say("moving on")]);
      const steps = await collect(runAgent({ ...base, client, tools: [taintingBoom] }));
      const result = steps[1] as AgentStep;
      expect(result.ran).toBe(true);
      expect(result.failed).toBe(true);
      expect(tookOutsideContent(result, taintingBoom)).toBe(true);
    });

    it("does not mark ran for a denied call — run() was never entered", async () => {
      const client = fakeClient([call("echo", '{"value":"hi"}'), say("fine")]);
      const steps = await collect(runAgent({ ...base, client, tools: [echo], permit: async () => "deny" as const }));
      const result = steps[1] as AgentStep;
      expect(result.ran).toBeFalsy();
      expect(tookOutsideContent(result, echo)).toBe(false);
    });

    it("does not mark ran for an unknown tool name", async () => {
      const client = fakeClient([call("nope", "{}"), say("recovered")]);
      const steps = await collect(runAgent({ ...base, client, tools: [echo] }));
      const result = steps[1] as AgentStep;
      expect(result.ran).toBeFalsy();
      expect(tookOutsideContent(result, undefined)).toBe(false);
    });

    it("does not mark ran for non-object arguments", async () => {
      const client = fakeClient([call("echo", "null"), say("recovered")]);
      const steps = await collect(runAgent({ ...base, client, tools: [echo] }));
      const result = steps[1] as AgentStep;
      expect(result.ran).toBeFalsy();
      expect(tookOutsideContent(result, echo)).toBe(false);
    });

    it("still marks ran true, and taints, on an ordinary successful call", async () => {
      const client = fakeClient([call("echo", '{"value":"hi"}'), say("all done")]);
      const steps = await collect(runAgent({ ...base, client, tools: [taintingBoom, echo] }));
      const result = steps[1] as AgentStep;
      expect(result.ran).toBe(true);
      expect(result.failed).toBe(false);
    });
  });

  it("stops at the iteration cap rather than looping forever", async () => {
    const client = fakeClient([
      call("echo", "{}"),
      call("echo", "{}"),
      call("echo", "{}"),
      call("echo", "{}"),
      call("echo", "{}"),
    ]);
    const steps = await collect(runAgent({ ...base, client, tools: [echo], maxIterations: 2 }));
    expect(steps.at(-1)).toMatchObject({ kind: "error" });
    expect((steps.at(-1) as any).text).toMatch(/2/);
  });

  it("offers the model only the tools it was given", async () => {
    const client = fakeClient([say("hi")]);
    await collect(runAgent({ ...base, client, tools: [echo] }));
    expect(client.seen[0].tools?.map((t) => t.name)).toEqual(["echo"]);
  });

  // Silence reads to a model as "this produced nothing", a different claim
  // than "this failed" — an empty string must not reach it as the tool result.
  it("replaces an empty tool result with a fallback message instead of sending blank content", async () => {
    const client = fakeClient([call("blank", "{}"), say("done")]);
    const steps = await collect(runAgent({ ...base, client, tools: [blank] }));
    expect((steps[1] as any).text.length).toBeGreaterThan(0);
    const followUp = client.seen[1].messages.at(-1) as { role: string; content: string };
    expect(followUp.role).toBe("tool");
    expect(followUp.content.length).toBeGreaterThan(0);
  });
});
