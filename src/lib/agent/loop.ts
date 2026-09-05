import { ChatMessage, LiteLLMClient } from "../litellm/types";
import { findTool, toolDefinitions } from "./toolset";
import { Tool } from "./types";

export type PermitDecision = "allow" | "deny";

export interface AgentStep {
  kind: "assistant" | "tool_call" | "tool_result" | "error";
  text: string;
  toolName?: string;
  /** Present on tool_result: whether the user was asked, and what they answered. */
  decision?: "auto" | "approved" | "denied";
  /**
   * Present on tool_result: true once `tool.run()` was actually entered, set
   * immediately before the call so it is true whether or not it throws.
   *
   * This — not `failed` — is what taint must key off. A throw can still carry
   * outside content: `web_fetch` embeds a redirect `Location` or a response
   * `Content-Encoding` header in its thrown message, `run_shell` embeds
   * stderr. None of that is authored by this extension just because the call
   * failed. `ran` is false for everything that never reached `run()` at all —
   * an unknown tool, unparseable/non-object arguments, a call the user denied
   * — because none of those can contain a tool's output, outside content or
   * otherwise.
   */
  ran?: boolean;
  /**
   * Present on tool_result: true when the call did not produce a real result —
   * unknown tool, unparseable/non-object arguments, denied, or `run()` threw.
   * The model uses this to tell an actual return apart from a failure it
   * should route around. It is not a taint signal — see `ran` for that.
   */
  failed?: boolean;
}

/**
 * Whether a tool_result step actually introduced content this extension did
 * not author into the conversation.
 *
 * Deliberately independent of `failed`: a thrown error is still a return
 * from inside `run()`, and the tools that throw with attacker-influenced
 * text in the message (a redirect target, a response header, a command's
 * stderr) do not stop being attacker-influenced because the call ended in an
 * exception rather than a resolved value. Keyed on `ran` instead — see its
 * doc comment on `AgentStep` for what does and does not set it.
 */
export function tookOutsideContent(step: AgentStep, tool: Tool | undefined): boolean {
  return step.kind === "tool_result" && !!step.ran && !!tool?.taints;
}

export interface RunAgentOptions {
  client: LiteLLMClient;
  model: string;
  messages: ChatMessage[];
  tools: Tool[];
  maxIterations: number;
  /** Decides whether a call may run. Task 4 supplies the real rules. */
  permit: (tool: Tool, input: Record<string, unknown>) => Promise<PermitDecision>;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * Drive the model until it answers without asking for a tool.
 *
 * Every failure a tool can produce — unknown name, unparseable arguments, a
 * throw, a refusal — is reported back to the model as the tool's result rather
 * than ending the run. A model that picked the wrong tool can then pick another;
 * one that is told nothing simply stops mid-task.
 */
export async function* runAgent(options: RunAgentOptions): AsyncGenerator<AgentStep> {
  const messages = [...options.messages];
  const definitions = toolDefinitions(options.tools);

  for (let iteration = 0; iteration < options.maxIterations; iteration++) {
    const reply = await options.client.complete({
      model: options.model,
      messages,
      temperature: options.temperature,
      tools: definitions.length ? definitions : undefined,
      signal: options.signal,
    });

    if (reply.toolCalls.length === 0) {
      yield { kind: "assistant", text: reply.content };
      return;
    }

    messages.push({ role: "assistant", content: reply.content, toolCalls: reply.toolCalls });
    if (reply.content.trim()) yield { kind: "assistant", text: reply.content };

    for (const call of reply.toolCalls) {
      yield { kind: "tool_call", text: call.arguments, toolName: call.name };

      const tool = findTool(options.tools, call.name);
      let output: string | undefined;
      let decision: AgentStep["decision"] = "auto";
      let failed = false;
      let ran = false;

      if (!tool) {
        output = `Error: unknown tool "${call.name}".`;
        failed = true;
      } else {
        let input: Record<string, unknown> | undefined;
        try {
          const parsed: unknown = JSON.parse(call.arguments || "{}");
          // JSON.parse accepts any value, not just objects. "null", "false" and
          // "0" all parse without throwing but are not an arguments object —
          // treating them as "no arguments" would skip permit()/run() silently
          // and hand the model a generic fallback instead of the real problem.
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
          } else {
            output = `Error: arguments were not a JSON object: ${call.arguments}`;
            failed = true;
          }
        } catch {
          output = `Error: arguments were not valid JSON: ${call.arguments}`;
          failed = true;
        }

        if (input) {
          const verdict = await options.permit(tool, input);
          if (verdict === "deny") {
            decision = "denied";
            output = `Error: the user denied permission to run "${call.name}".`;
            failed = true;
          } else {
            decision = "approved";
            // Set immediately before the call, not after it resolves: `ran`
            // exists specifically to be true whether `run()` returns or
            // throws, so it has to be assigned before either can happen.
            ran = true;
            try {
              output = await tool.run(input);
            } catch (err) {
              output = `Error: ${err instanceof Error ? err.message : String(err)}`;
              failed = true;
            }
          }
        }
      }

      // Every branch above assigns, but the model must never receive an empty
      // tool result: silence reads as "this produced nothing", not "this failed".
      // `??` alone would let a tool that resolves to "" (e.g. an empty page)
      // through unchanged, so blank/whitespace-only output is caught too.
      const text = output?.trim() ? output : `Error: "${call.name}" produced no result.`;
      yield { kind: "tool_result", text, toolName: call.name, decision, failed, ran };
      messages.push({ role: "tool", content: text, toolCallId: call.id });
    }
  }

  yield { kind: "error", text: `Stopped after ${options.maxIterations} iterations without a final answer.` };
}
