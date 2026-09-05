/**
 * Escapes ASCII control characters — most importantly `\n`/`\r` — and caps
 * length, before a value is interpolated into a Raycast confirmation dialog.
 *
 * A value shown in a dialog may legally contain a newline; unescaped, that
 * newline pushes whatever comes after it below the visible area. Length
 * alone can do the same even with no control characters at all. Originally
 * written for `tools/files.ts`'s own refusal/preview messages (see
 * `reasonPair`/`describeLocation` there) and moved here so every
 * confirmation surface in the agent — including `AgentView`'s fallback for
 * tools with no `describe()` of their own — can apply the same treatment
 * instead of re-implementing it.
 */
export function forDisplay(text: string, maxChars: number): string {
  // U+2028/U+2029/U+0085 (LINE SEPARATOR, PARAGRAPH SEPARATOR, NEXT LINE) are
  // outside the ASCII control range but AppKit renders each as a line break
  // exactly like \n — left unescaped, a value packed with them defeats the
  // length cap the same way an unescaped \n would.
  // eslint-disable-next-line no-control-regex -- matching control characters is the point: they are what gets escaped below.
  const escaped = text.replace(/[\x00-\x1f\x7f\u2028\u2029\u0085]/g, (ch) => {
    if (ch === "\n") return "\\n";
    if (ch === "\r") return "\\r";
    if (ch === "\t") return "\\t";
    const code = ch.charCodeAt(0);
    // \x for anything a byte can hold (matches the pre-existing style for
    // \x1f/\x7f/\x85); \u for the two codepoints that don't fit in a byte.
    return code > 0xff ? `\\u${code.toString(16).padStart(4, "0")}` : `\\x${code.toString(16).padStart(2, "0")}`;
  });
  return escaped.length > maxChars ? `${escaped.slice(0, maxChars)}… [truncated]` : escaped;
}

/** How much of a single argument value is shown before the rest of the fallback confirmation dialog. */
const MAX_ARGUMENT_VALUE_CHARS = 300;

/**
 * How many top-level arguments are rendered before the rest are collapsed
 * into a trailer. Uncapped, 400 one-character junk keys ahead of the real
 * one cost the model nothing (tools ignore unknown keys) and reproduce the
 * exact "pushed off the bottom" failure a single padded value caused — just
 * via entry count instead of value length.
 */
const MAX_ARGUMENT_ENTRIES = 20;

/**
 * Renders a tool's raw arguments for the confirmation dialog used by tools
 * with no `describe()` of their own (`run_shell`, `web_fetch`,
 * `write_clipboard`, `paste_text` at present — see `AgentView`).
 *
 * `JSON.stringify(input, null, 2)` alone is rendered in the model's own key
 * order with no cap on any value: `{"padding": "z".repeat(5000), "command":
 * "git log"}` put `"command"` at character 5021, off the bottom of the
 * dialog, and the user approved without ever seeing it. What actually holds
 * now: every rendered value is capped and has every line-breaking character
 * — ASCII control codes and U+2028/U+2029/U+0085 — escaped (via
 * `forDisplay`), so a single value can no longer add a line by itself; and
 * the number of entries rendered is separately capped, with a trailer
 * naming how many were left out, so many short entries can't do the same
 * thing by sheer count. Key order is the model's own choice, so this can't
 * promise any particular argument stays visible — only that the dialog
 * itself stays a bounded size and visibly says so when it's hiding
 * something, instead of silently truncating the user's view.
 */
export function describeArgumentsFallback(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  const shown = entries
    .slice(0, MAX_ARGUMENT_ENTRIES)
    .map(
      ([key, value]) =>
        `${forDisplay(key, MAX_ARGUMENT_VALUE_CHARS)}: ${forDisplay(JSON.stringify(value), MAX_ARGUMENT_VALUE_CHARS)}`,
    );
  const omitted = entries.length - shown.length;
  if (omitted > 0) shown.push(`… ${omitted} more arguments not shown`);
  return shown.join("\n");
}
