import { ToolRisk } from "./types";

export type Decision = "allow" | "ask" | "deny";

/**
 * Characters that let a second command ride along with an allowlisted one.
 *
 * Metacharacters that are never allowed in an allowlisted command.
 */
const METACHARACTERS = /[;&|`$><]/;

/**
 * Whitespace other than plain space. JavaScript's `\s` includes Unicode whitespace
 * (NBSP, line separator, ideographic space, etc.), so we reject any whitespace
 * that is NOT a plain space U+0020. This is defined as [^\S ] (anything that is
 * whitespace but not space).
 */
const NONSPACE_WHITESPACE = /[^\S ]/;

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Whether a shell command may run at all.
 *
 * Matching the first word is not enough on its own: `ls; rm -rf /` starts with
 * an allowlisted word and ends somewhere else entirely. We reject if the command
 * contains any metacharacter or any whitespace other than plain space (the only
 * character we tokenise on). This makes the disqualifying set and tokeniser agree
 * by construction, immune to future changes in what `\s` means.
 */
export function shellCommandAllowed(command: string, allowlist: string[]): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (METACHARACTERS.test(trimmed)) return false;
  if (NONSPACE_WHITESPACE.test(trimmed)) return false;
  return allowlist.includes(trimmed.split(/ +/)[0]);
}

export function decide(input: {
  risk: ToolRisk;
  tainted: boolean;
  writeToolsEnabled: boolean;
  shellAllowlist: string[];
  readLocalApproved: boolean;
  command?: string;
}): Decision {
  if (input.risk === "read") return "allow";

  if (!input.writeToolsEnabled && (input.risk === "write" || input.risk === "execute")) return "deny";

  if (input.risk === "execute" && !shellCommandAllowed(input.command ?? "", input.shellAllowlist)) return "deny";

  // Everything below this point is either an ask or a remembered allow, and
  // taint removes the remembering: the conversation now contains text the user
  // did not write, so no prior approval covers what it might ask for.
  if (input.tainted) return "ask";

  // A model-chosen destination is a channel out, not a write, so the write
  // switch above does not gate it — but taint has already been ruled out at
  // this point, so a clean session may fetch freely.
  if (input.risk === "read_remote") return "allow";

  if (input.risk === "read_local") return input.readLocalApproved ? "allow" : "ask";

  return "ask";
}
