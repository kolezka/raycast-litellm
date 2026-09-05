import { LocalStorage } from "@raycast/api";
import { Creativity } from "../enums";

const KEY = "agent:skills";

export interface Skill {
  id: string;
  name: string;
  instructions: string;
  /** Tool names this skill may use. The registry is filtered to these. */
  tools: string[];
  model?: string;
  creativity: Creativity;
}

export async function listSkills(): Promise<Skill[]> {
  const raw = await LocalStorage.getItem<string>(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveSkill(skill: Skill): Promise<void> {
  const all = (await listSkills()).filter((s) => s.id !== skill.id);
  all.push(skill);
  await LocalStorage.setItem(KEY, JSON.stringify(all));
}

export async function deleteSkill(id: string): Promise<void> {
  const all = (await listSkills()).filter((s) => s.id !== id);
  await LocalStorage.setItem(KEY, JSON.stringify(all));
}

/** Returns an error message, or undefined when the draft is usable. */
export function validateSkill(draft: { name: string; instructions: string; tools: string[] }): string | undefined {
  if (!draft.name.trim()) return "Name is required";
  if (!draft.instructions.trim()) return "Instructions are required";
  if (draft.tools.length === 0) return "Select at least one tool";
  return undefined;
}

/**
 * Temperature to run a skill — or an unscoped agent run — at.
 *
 * `Skill.creativity` is collected on the creation form and validated by
 * `validateSkill`'s caller, but until this existed nothing ever read it back:
 * `AgentView` never passed `temperature` to `runAgent`, so the provider
 * default applied regardless of what a skill's creator chose. Every other
 * view in this extension sets `temperature` explicitly (see
 * `AnswerView/main.tsx`); `Creativity.Low` is that same default, applied here
 * for the case this function exists to handle — no skill, i.e. the agent run
 * unscoped.
 */
export function resolveTemperature(skill?: Pick<Skill, "creativity">): Creativity {
  return skill?.creativity ?? Creativity.Low;
}
