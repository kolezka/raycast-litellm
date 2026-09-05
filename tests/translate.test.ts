import { describe, expect, it } from "vitest";
import { fillLanguages } from "../src/lib/translate";

describe("fillLanguages", () => {
  it("substitutes both language tokens", () => {
    expect(fillLanguages("{source} to {target}", { source: "Polish", target: "English" })).toBe("Polish to English");
  });

  it("replaces every occurrence", () => {
    expect(fillLanguages("{target}/{target}", { source: "a", target: "b" })).toBe("b/b");
  });

  // Same invariant fillPlaceholders locks: a substituted value must never be
  // re-scanned, or a language named after the other token gets rewritten.
  it("does not re-scan substituted text", () => {
    expect(fillLanguages("{source}|{target}", { source: "{target}", target: "German" })).toBe("{target}|German");
  });

  it("does not treat replacement text as a pattern", () => {
    expect(fillLanguages("{target}", { source: "x", target: "$& $1" })).toBe("$& $1");
  });
});
