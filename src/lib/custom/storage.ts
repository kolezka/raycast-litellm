import { LocalStorage } from "@raycast/api";
import { Creativity } from "../enums";

const KEY = "custom:commands";

export interface CustomCommand {
  id: string;
  name: string;
  prompt: string;
  model?: string;
  creativity: Creativity;
}

export async function listCustomCommands(): Promise<CustomCommand[]> {
  const raw = await LocalStorage.getItem<string>(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupted store: an unusable list beats a command that cannot open.
    return [];
  }
}

export async function saveCustomCommand(command: CustomCommand): Promise<void> {
  const all = (await listCustomCommands()).filter((c) => c.id !== command.id);
  all.push(command);
  await LocalStorage.setItem(KEY, JSON.stringify(all));
}

export async function deleteCustomCommand(id: string): Promise<void> {
  const all = (await listCustomCommands()).filter((c) => c.id !== id);
  await LocalStorage.setItem(KEY, JSON.stringify(all));
}

/** Returns an error message, or undefined when the draft is usable. */
export function validateCustomCommand(draft: { name: string; prompt: string }): string | undefined {
  if (!draft.name.trim()) return "Name is required";
  // A prompt without the placeholder still runs: it reaches the model with the
  // user's text nowhere in it, and answers a question they never asked.
  if (!draft.prompt.includes("{selection}")) return "Prompt must contain {selection}";
  return undefined;
}
