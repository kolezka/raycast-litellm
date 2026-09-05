import { describe, expect, it } from "vitest";
import { parseChatStream, StreamChunk } from "../src/lib/litellm/client";

async function* iter(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const c of chunks) yield c;
}

async function collect(chunks: StreamChunk[]) {
  const out = [];
  for await (const c of parseChatStream(iter(chunks))) out.push(c);
  return out;
}

const reasoningStream: StreamChunk[] = [
  { choices: [{ delta: { role: "assistant", reasoning_content: "" } }] },
  { choices: [{ delta: { reasoning_content: "We" } }] },
  { choices: [{ delta: { reasoning_content: " need" } }] },
  { choices: [{ delta: { content: "STREAM" } }] },
  { choices: [{ delta: { content: " OK" } }] },
  {
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
  },
];

const plainStream: StreamChunk[] = [
  { choices: [{ delta: { role: "assistant", content: "" } }] },
  { choices: [{ delta: { content: "ST" } }] },
  { choices: [{ delta: { content: "REAM" }, finish_reason: "stop" }] },
];

describe("parseChatStream", () => {
  it("keeps reasoning separate from the answer", async () => {
    const out = await collect(reasoningStream);
    const last = out[out.length - 1];
    expect(last.reasoning).toBe("We need");
    expect(last.content).toBe("STREAM OK");
  });

  it("never leaks reasoning into content", async () => {
    for (const c of await collect(reasoningStream)) {
      expect(c.content).not.toContain("need");
    }
  });

  it("accumulates plain content streams", async () => {
    const out = await collect(plainStream);
    expect(out[out.length - 1].content).toBe("STREAM");
    expect(out[out.length - 1].reasoning).toBe("");
  });

  it("marks only the final chunk done and reports usage", async () => {
    const out = await collect(reasoningStream);
    expect(out.filter((c) => c.done)).toHaveLength(1);
    expect(out[out.length - 1].done).toBe(true);
    expect(out[out.length - 1].usage).toEqual({ promptTokens: 9, completionTokens: 4, totalTokens: 13 });
  });

  it("emits a done chunk even when the stream carries no usage", async () => {
    const out = await collect(plainStream);
    expect(out[out.length - 1].done).toBe(true);
    expect(out[out.length - 1].usage).toBeUndefined();
  });

  it("propagates a mid-stream disconnect instead of completing silently", async () => {
    async function* broken(): AsyncGenerator<StreamChunk> {
      yield { choices: [{ delta: { content: "par" } }] };
      throw Object.assign(new Error("terminated"), { name: "TypeError" });
    }
    const seen: string[] = [];
    await expect(async () => {
      for await (const c of parseChatStream(broken())) seen.push(c.content);
    }).rejects.toThrow("terminated");
    expect(seen).toEqual(["par"]);
  });

  it("rejects a stream that ends without a finish_reason", async () => {
    // openai v7 does NOT throw when a stream is aborted — its iterator returns.
    // Without this guard a cancelled or dropped stream arrives here looking like
    // a clean completion, and a truncated answer renders as if it were finished.
    const truncated: StreamChunk[] = [{ choices: [{ delta: { content: "half an ans" } }] }];
    await expect(collect(truncated)).rejects.toThrow(/ended before the model finished/i);
  });
});

import { toAssistantMessage } from "../src/lib/litellm/client";

describe("toAssistantMessage", () => {
  it("carries tool calls through with their raw argument JSON", () => {
    const msg = toAssistantMessage({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "web_fetch", arguments: '{"url":"https://x"}' } },
            ],
          },
        },
      ],
    });
    expect(msg.content).toBe("");
    expect(msg.toolCalls).toEqual([{ id: "call_1", name: "web_fetch", arguments: '{"url":"https://x"}' }]);
  });

  it("returns text with no tool calls as an empty array, never undefined", () => {
    const msg = toAssistantMessage({ choices: [{ message: { content: "plain answer" } }] });
    expect(msg.content).toBe("plain answer");
    expect(msg.toolCalls).toEqual([]);
  });

  it("keeps reasoning separate from the answer", () => {
    const msg = toAssistantMessage({
      choices: [{ message: { content: "42", reasoning_content: "thinking" } }],
    });
    expect(msg.content).toBe("42");
    expect(msg.reasoning).toBe("thinking");
  });

  // A model may narrate and call a tool in the same turn. Dropping either half
  // loses the explanation or the action.
  it("keeps content and tool calls when both are present", () => {
    const msg = toAssistantMessage({
      choices: [
        {
          message: {
            content: "Let me look that up.",
            tool_calls: [{ id: "c2", type: "function", function: { name: "web_search", arguments: "{}" } }],
          },
        },
      ],
    });
    expect(msg.content).toBe("Let me look that up.");
    expect(msg.toolCalls).toHaveLength(1);
  });

  it("survives a response with no choices rather than throwing", () => {
    expect(toAssistantMessage({ choices: [] })).toEqual({ content: "", reasoning: "", toolCalls: [] });
  });
});
