import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: async (k: string) => store.get(k),
    setItem: async (k: string, v: string) => void store.set(k, v),
  },
}));

const { Creativity } = await import("../src/lib/enums");
const { listSkills, saveSkill, deleteSkill, validateSkill, resolveTemperature } =
  await import("../src/lib/agent/skills");

const draft = { name: "Researcher", instructions: "Find things out.", tools: ["web_search"] };

describe("skill storage", () => {
  beforeEach(() => store.clear());

  it("round-trips a skill", async () => {
    await saveSkill({ id: "1", ...draft, creativity: Creativity.Low });
    expect((await listSkills()).map((s) => s.name)).toEqual(["Researcher"]);
  });

  it("replaces rather than duplicates on re-save", async () => {
    await saveSkill({ id: "1", ...draft, creativity: Creativity.Low });
    await saveSkill({ id: "1", ...draft, name: "Renamed", creativity: Creativity.Low });
    const all = await listSkills();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Renamed");
  });

  it("deletes by id", async () => {
    await saveSkill({ id: "1", ...draft, creativity: Creativity.Low });
    await deleteSkill("1");
    expect(await listSkills()).toEqual([]);
  });

  it("survives a corrupted store", async () => {
    store.set("agent:skills", "{not json");
    expect(await listSkills()).toEqual([]);
  });
});

describe("validateSkill", () => {
  it("rejects an empty name", () => {
    expect(validateSkill({ name: " ", instructions: "x", tools: ["web_search"] })).toMatch(/name/i);
  });

  it("rejects empty instructions", () => {
    expect(validateSkill({ name: "X", instructions: "  ", tools: ["web_search"] })).toMatch(/instruction/i);
  });

  // A skill with no tools is a custom command wearing a different hat, and the
  // agent loop would spend an iteration discovering it can do nothing.
  it("rejects a skill with no tools selected", () => {
    expect(validateSkill({ name: "X", instructions: "y", tools: [] })).toMatch(/tool/i);
  });

  it("accepts a valid draft", () => {
    expect(validateSkill(draft)).toBeUndefined();
  });
});

describe("resolveTemperature", () => {
  // I5: Skill.creativity was collected, validated and stored, but AgentView
  // never read it back — runAgent got no `temperature` at all, so the
  // provider default applied regardless of what a skill's creator chose.
  it("uses the skill's own creativity when scoped to one", () => {
    expect(resolveTemperature({ creativity: Creativity.High })).toBe(Creativity.High);
    expect(resolveTemperature({ creativity: Creativity.None })).toBe(Creativity.None);
  });

  // Matches AnswerView and every other view in the extension, which all set
  // Creativity.Low explicitly rather than leaving the provider default to
  // apply when nothing more specific is configured.
  it("defaults to Creativity.Low when running unscoped", () => {
    expect(resolveTemperature(undefined)).toBe(Creativity.Low);
  });
});
