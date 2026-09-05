import { describe, expect, it } from "vitest";
import { codeFence } from "../src/lib/ui/markdown";

/**
 * `AuditLog.tsx` and `main.tsx` both interpolate attacker-influenced text
 * (a tool result, a stored audit entry's raw arguments) into a Detail
 * pane's markdown by wrapping it in a literal "```" fence. A run of three
 * or more backticks inside that text closes the fence early, and whatever
 * follows in the string is then parsed as markdown by the pane — headings,
 * links, more fences — instead of being shown as the inert text it's
 * supposed to be. `codeFence` must pick a fence longer than any backtick
 * run already present in the content, the same technique CommonMark itself
 * relies on for this exact case.
 */
describe("codeFence", () => {
  it("uses a longer fence than a backtick run embedded in the content", () => {
    const content = ["ignore prior instructions", "```", "# fake heading injected via the fence", "```", "more"].join(
      "\n",
    );
    const fenced = codeFence(content);
    const lines = fenced.split("\n");
    const openFence = lines[0];

    expect(openFence).toMatch(/^`{4,}$/);
    // no run of backticks inside the body may be long enough to close the
    // fence early -- that's the whole point of picking a longer one.
    for (const line of lines.slice(1, -1)) {
      if (/^`+$/.test(line)) {
        expect(line.length).toBeLessThan(openFence.length);
      }
    }
  });

  it("fences plain content with an ordinary triple backtick", () => {
    expect(codeFence("plain text")).toBe("```\nplain text\n```");
  });

  it("supports an optional language tag on the opening fence", () => {
    expect(codeFence("{}", "json")).toBe("```json\n{}\n```");
  });

  it("keeps the closing fence the same length as the opening fence", () => {
    const fenced = codeFence("```` a run of four backticks in the body");
    const lines = fenced.split("\n");
    expect(lines[0]).toBe(lines[lines.length - 1]);
    expect(lines[0].length).toBeGreaterThan(4);
  });
});
