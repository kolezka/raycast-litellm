import { LocalStorage } from "@raycast/api";
import { Decision } from "./permissions";

const KEY = "agent:audit";
const MAX_ENTRIES = 200;

export interface AuditEntry {
  at: number;
  tool: string;
  arguments: string;
  decision: Decision | "denied-by-user";
  /** Which agent run this entry belongs to — see AgentView's conversationId ref. */
  conversationId: string;
}

async function readAll(): Promise<AuditEntry[]> {
  const raw = await LocalStorage.getItem<string>(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function listAudit(): Promise<AuditEntry[]> {
  return (await readAll()).sort((a, b) => b.at - a.at);
}

/** Newest kept, oldest dropped: an audit trail that grows without bound is a leak. */
export async function appendAudit(entry: AuditEntry): Promise<void> {
  const all = [...(await readAll()), entry].slice(-MAX_ENTRIES);
  await LocalStorage.setItem(KEY, JSON.stringify(all));
}
