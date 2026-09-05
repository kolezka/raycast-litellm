import { ToolDefinition } from "../litellm/types";

/**
 * What a tool is permitted to do, from harmless to irreversible.
 *
 * `read_remote` is a read that also leaves the machine — the destination is a
 * URL the model chose, which can be influenced by content already in the
 * conversation. That is why it is gated by taint the same way writes are,
 * while a plain `read` (nothing goes out) is not.
 */
export type ToolRisk = "read" | "read_remote" | "read_local" | "write" | "execute";

export interface Tool {
  definition: ToolDefinition;
  risk: ToolRisk;
  /**
   * True when the result carries content this extension did not author.
   *
   * Drives the permission override: once such a result is in the conversation,
   * anything that writes or executes is acting partly on instructions from
   * whoever wrote that content.
   */
  taints: boolean;
  /**
   * Optional human-readable statement of what this call will actually do.
   *
   * The confirmation dialog otherwise shows the model's raw arguments
   * verbatim — accurate for the string the model wrote, but not necessarily
   * for what happens on disk (a relative path resolved against an invisible
   * cwd, a symlinked ancestor directory redirecting a write elsewhere). A
   * tool whose input can diverge from its real effect should implement this
   * so the user is consenting to the effect, not to the model's wording.
   */
  describe?(input: Record<string, unknown>): Promise<string>;
  /**
   * No `AbortSignal` here, deliberately, not an oversight: Stop (AgentView)
   * aborts the model request between tool calls via `RunAgentOptions.signal`,
   * but once a call has entered `run()` there is no way to cancel it
   * mid-flight — the loop can only wait for it to settle. What actually
   * bounds that wait is each tool's own transport deadline (see
   * `REQUEST_TIMEOUT_MS` in `tools/web.ts`), not this signature. Threading
   * cancellation through here is a real gap, left open rather than
   * half-wired through only some tools.
   */
  run(input: Record<string, unknown>): Promise<string>;
}
