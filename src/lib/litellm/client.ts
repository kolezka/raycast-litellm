import OpenAI from "openai";
import {
  ChatChunk,
  ChatMessage,
  ChatModel,
  ChatRequest,
  LiteLLMClient,
  LiteLLMConfig,
  AssistantMessage,
  ToolDefinition,
} from "./types";
import { classifyError, LiteLLMError } from "./errors";
import { fetchChatModels } from "./models";

/** Minimal shape of an OpenAI-compatible streamed chunk, plus LiteLLM's reasoning field. */
export interface StreamChunk {
  choices?: {
    delta?: { role?: string; content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

/**
 * Fold a raw chunk stream into cumulative {content, reasoning} snapshots.
 *
 * Reasoning models emit `delta.reasoning_content` while thinking and only later
 * `delta.content`. Concatenating the two would render the model's scratchpad as
 * if it were the answer, so they are accumulated apart.
 *
 * A stream that ends without a `finish_reason` is treated as truncated and
 * throws. This matters because openai v7 swallows aborts: its iterator returns
 * rather than throwing, so without this check a cancelled or dropped stream
 * would be reported as a clean completion.
 */
export async function* parseChatStream(source: AsyncIterable<StreamChunk>): AsyncGenerator<ChatChunk> {
  let content = "";
  let reasoning = "";
  let usage: ChatChunk["usage"];
  let finished = false;

  for await (const chunk of source) {
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finished = true;

    const delta = choice?.delta;
    if (delta?.content) content += delta.content;
    if (delta?.reasoning_content) reasoning += delta.reasoning_content;

    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
        totalTokens: chunk.usage.total_tokens ?? 0,
      };
    }
    yield { content, reasoning, done: false, usage: undefined };
  }

  if (!finished) {
    throw new LiteLLMError({ kind: "Unknown", message: "The stream ended before the model finished." });
  }

  yield { content, reasoning, done: true, usage };
}

/** Minimal shape of a non-streamed completion, plus LiteLLM's reasoning field. */
export interface CompletionResponse {
  choices?: {
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
}

export function toAssistantMessage(response: CompletionResponse): AssistantMessage {
  const message = response.choices?.[0]?.message;
  return {
    content: message?.content ?? "",
    reasoning: message?.reasoning_content ?? "",
    toolCalls: (message?.tool_calls ?? []).map((call, i) => ({
      id: call.id ?? `call_${i}`,
      name: call.function?.name ?? "",
      arguments: call.function?.arguments ?? "{}",
    })),
  };
}

function toOpenAITools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function toOpenAIMessages(messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
    }
    if (m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: c.arguments },
        })),
      };
    }
    if (!m.images?.length) return { role: m.role, content: m.content } as OpenAI.ChatCompletionMessageParam;
    return {
      role: "user",
      content: [
        { type: "text", text: m.content },
        ...m.images.map((img) => ({ type: "image_url" as const, image_url: { url: img.dataUri } })),
      ],
    } as OpenAI.ChatCompletionMessageParam;
  });
}

export function createClient(cfg: LiteLLMConfig): LiteLLMClient {
  const openai = new OpenAI({ apiKey: cfg.apiKey, baseURL: `${cfg.baseUrl}/v1` });

  return {
    async *chat(request: ChatRequest): AsyncGenerator<ChatChunk, void, undefined> {
      // The SDK's own `timeout` option bounds time-to-first-byte only: it clears
      // its timer when fetch resolves, which is when headers arrive, not when the
      // SSE body ends. A proxy that sends headers then stalls would hang forever.
      // So we run an idle timer and re-arm it on every chunk.
      const idle = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(), cfg.timeoutMs);
      };
      const signal = request.signal ? AbortSignal.any([request.signal, idle.signal]) : idle.signal;

      try {
        arm();
        const stream = await openai.chat.completions.create(
          {
            model: request.model,
            messages: toOpenAIMessages(request.messages),
            temperature: request.temperature,
            max_tokens: request.maxTokens,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal },
        );

        for await (const chunk of parseChatStream(stream as AsyncIterable<StreamChunk>)) {
          arm();
          yield chunk;
        }
      } catch (err) {
        // Distinguish our idle timer from the caller cancelling: only the former
        // is a Timeout the user should be told to raise the preference for.
        if (idle.signal.aborted && !request.signal?.aborted) {
          throw new LiteLLMError({
            kind: "Timeout",
            message: `The proxy sent nothing for ${Math.round(cfg.timeoutMs / 1000)}s.`,
          });
        }
        throw classifyError(err);
      } finally {
        clearTimeout(timer);
      }
    },

    async complete(request: ChatRequest): Promise<AssistantMessage> {
      try {
        const response = await openai.chat.completions.create(
          {
            model: request.model,
            messages: toOpenAIMessages(request.messages),
            temperature: request.temperature,
            max_tokens: request.maxTokens,
            stream: false,
            ...(request.tools?.length ? { tools: toOpenAITools(request.tools) } : {}),
          },
          { signal: request.signal, timeout: cfg.timeoutMs },
        );
        return toAssistantMessage(response as CompletionResponse);
      } catch (err) {
        throw classifyError(err);
      }
    },

    async listChatModels(signal?: AbortSignal): Promise<ChatModel[]> {
      return fetchChatModels(cfg, signal);
    },
  };
}
