import { ToolDefinition } from "../litellm/types";
import { Tool } from "./types";

/**
 * Pure operations over a `Tool[]` list — no dependency on any concrete tool's
 * implementation. Kept separate from `registry.ts`, which imports the Raycast
 * tools and therefore `@raycast/api`: the agent loop needs these functions
 * without dragging that import chain into vitest, where `@raycast/api` has no
 * resolvable module entry outside the Raycast runtime.
 */

export function findTool(tools: Tool[], name: string): Tool | undefined {
  return tools.find((t) => t.definition.name === name);
}

/**
 * Restrict to an allowlist. Applied before definitions are built, so a tool
 * outside the list is not merely refused when called — the model is never told
 * it exists.
 */
export function filterTools(tools: Tool[], allowed: string[]): Tool[] {
  return tools.filter((t) => allowed.includes(t.definition.name));
}

export function toolDefinitions(tools: Tool[]): ToolDefinition[] {
  return tools.map((t) => t.definition);
}
