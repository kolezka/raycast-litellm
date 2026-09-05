import { describe, expect, it } from "vitest";
import { fillPlaceholders, PROMPTS } from "../src/lib/prompts";
import { CommandName } from "../src/lib/enums";

describe("fillPlaceholders", () => {
  it("substitutes {selection}", () => {
    expect(fillPlaceholders("Text: {selection}\n", { selection: "Philosophy" })).toBe("Text: Philosophy\n");
  });

  it("substitutes {browser-tab}", () => {
    expect(fillPlaceholders("{browser-tab}", { browserTab: "<html>" })).toBe("<html>");
  });

  it("replaces every occurrence", () => {
    expect(fillPlaceholders("{selection}/{selection}", { selection: "x" })).toBe("x/x");
  });

  it("leaves an unsupplied placeholder empty rather than literal", () => {
    expect(fillPlaceholders("a{selection}b", {})).toBe("ab");
  });

  it("does not treat replacement text as a pattern", () => {
    expect(fillPlaceholders("{selection}", { selection: "$& $1" })).toBe("$& $1");
  });

  // Substituted text must never be re-scanned: otherwise a selection mentioning
  // {browser-tab} gets the page content spliced into it, or silently emptied.
  it("does not re-scan substituted text", () => {
    const out = fillPlaceholders("Page: {browser-tab}\nNote: {selection}", {
      selection: "see {browser-tab} below",
      browserTab: "<html>PAGE</html>",
    });
    expect(out).toBe("Page: <html>PAGE</html>\nNote: see {browser-tab} below");
  });

  it("does not re-scan substituted text in the other direction", () => {
    const out = fillPlaceholders("Page: {browser-tab}\nNote: {selection}", {
      selection: "some note",
      browserTab: "page mentions {selection} here",
    });
    expect(out).toBe("Page: page mentions {selection} here\nNote: some note");
  });
});

describe("PROMPTS", () => {
  it("defines the explain prompt with a selection placeholder", () => {
    expect(PROMPTS[CommandName.EXPLAIN]!.template).toContain("{selection}");
  });
});

const TRANSFORMATION_COMMANDS = [
  CommandName.BROWSER_SUMMARIZE,
  CommandName.CASUAL,
  CommandName.CODE_EXPLAIN,
  CommandName.CONFIDENT,
  CommandName.EXPLAIN,
  CommandName.FIX,
  CommandName.FRIENDLY,
  CommandName.IMPROVE,
  CommandName.LONGER,
  CommandName.PROFESSIONAL,
  CommandName.SHORTER,
  CommandName.TRANSLATE,
  CommandName.TWEET,
];

describe("prompt coverage", () => {
  it("defines a prompt for all thirteen transformation commands", () => {
    for (const c of TRANSFORMATION_COMMANDS) {
      expect(PROMPTS[c], `missing prompt for ${c}`).toBeDefined();
    }
  });

  it("gives every prompt a placeholder to fill", () => {
    for (const c of TRANSFORMATION_COMMANDS) {
      const t = PROMPTS[c]!.template;
      expect(t.includes("{selection}") || t.includes("{browser-tab}"), `${c} has no placeholder`).toBe(true);
    }
  });

  it("gives browser-summarize its own key, not the tweet key", () => {
    expect(PROMPTS[CommandName.BROWSER_SUMMARIZE]!.template).not.toBe(PROMPTS[CommandName.TWEET]!.template);
  });

  // Upstream wrote the translate prompt as a JS template literal interpolating
  // Raycast command arguments. Carrying that syntax over verbatim would ship a
  // prompt asking the model to translate "into ${props.arguments.target}", so
  // the tokens are ours while the wording stays upstream's.
  it("uses fillable language tokens in translate, not upstream's JS interpolation", () => {
    const t = PROMPTS[CommandName.TRANSLATE]!.template;
    expect(t).not.toContain("${props.arguments");
    expect(t).toContain("{source}");
    expect(t).toContain("{target}");
  });
});
