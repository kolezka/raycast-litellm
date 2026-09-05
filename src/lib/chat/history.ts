import { LocalStorage } from "@raycast/api";
import { ChatMessage } from "../litellm/types";

const KEY = "chat:conversations";

export interface Conversation {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  updatedAt: number;
}

async function readAll(): Promise<Conversation[]> {
  const raw = await LocalStorage.getItem<string>(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupted store: start clean rather than crashing the view on every open.
    return [];
  }
}

export async function listConversations(): Promise<Conversation[]> {
  return (await readAll()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  const all = (await readAll()).filter((c) => c.id !== conversation.id);
  all.push(conversation);
  await LocalStorage.setItem(KEY, JSON.stringify(all));
}

export async function deleteConversation(id: string): Promise<void> {
  const all = (await readAll()).filter((c) => c.id !== id);
  await LocalStorage.setItem(KEY, JSON.stringify(all));
}

/** Label for a conversation in the history list. */
export function conversationTitle(messages: ChatMessage[]): string {
  const opening = messages
    .find((m) => m.role === "user")
    ?.content.replace(/\s+/g, " ")
    .trim();
  if (!opening) return "New conversation";
  return opening.length > 60 ? `${opening.slice(0, 59)}…` : opening;
}

/**
 * Read the Chat Memory Messages preference into a message count.
 *
 * `Number(raw) || 20` would be shorter but reads "0" as unset and hands back
 * twenty, so a user asking for no context gets the opposite. Only genuinely
 * absent or unparseable input falls back to the default.
 */
export function parseHistoryLimit(raw: string | undefined): number {
  const n = Number(raw?.trim());
  if (!raw?.trim() || !Number.isFinite(n)) return 20;
  return Math.max(0, Math.trunc(n));
}

/**
 * The most recent `limit` messages, always keeping a leading system message.
 *
 * `limit` reaches here from the Chat Memory Messages preference, a free text
 * field, so zero and negative values are reachable. They are floored to zero
 * rather than passed to `slice(-limit)`, where `slice(-0)` is `slice(0)` and
 * would send the entire conversation — the exact opposite of the request.
 */
export function windowMessages(messages: ChatMessage[], limit: number): ChatMessage[] {
  const system = messages[0]?.role === "system" ? [messages[0]] : [];
  const rest = messages.slice(system.length);
  return [...system, ...(limit > 0 ? rest.slice(-limit) : [])];
}
