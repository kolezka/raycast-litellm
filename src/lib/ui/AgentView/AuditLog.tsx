import { Action, ActionPanel, Icon, List } from "@raycast/api";
import * as React from "react";
import { AuditEntry, listAudit } from "../../agent/audit";
import { codeFence } from "../markdown";

const DECISION_ICONS: Record<AuditEntry["decision"], Icon> = {
  allow: Icon.CheckCircle,
  ask: Icon.QuestionMarkCircle,
  deny: Icon.XmarkCircle,
  "denied-by-user": Icon.XmarkCircle,
};

/** Arguments are stored as a JSON string; shown pretty-printed when they parse, raw otherwise. */
function prettyArguments(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * The permission model's other half: `decide()` (permissions.ts) writes
 * every verdict to `LocalStorage` via `appendAudit`, but nothing ever read
 * it back — `listAudit` was exported and never called. An audit trail
 * nobody can see removes the accountability it exists to provide.
 */
export function AuditLog(): React.JSX.Element {
  const [entries, setEntries] = React.useState<AuditEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await listAudit();
      if (!cancelled) {
        setEntries(saved);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <List isLoading={loading} isShowingDetail={entries.length > 0} searchBarPlaceholder="Search the audit log…">
      <List.EmptyView icon={Icon.List} title="No audit entries yet" description="Run the agent to record one." />
      {entries.map((entry, i) => (
        <List.Item
          key={i}
          title={entry.tool}
          subtitle={entry.decision}
          icon={DECISION_ICONS[entry.decision]}
          accessories={[{ date: new Date(entry.at) }]}
          detail={
            <List.Item.Detail
              markdown={[
                `**Tool:** ${entry.tool}`,
                `**Decision:** ${entry.decision}`,
                `**Conversation:** ${entry.conversationId}`,
                `**Time:** ${new Date(entry.at).toLocaleString()}`,
                "",
                // The model chose these arguments; a stored entry can contain
                // its own "```" and break out of a fixed fence into rendered
                // markdown. codeFence sizes the fence around the content instead.
                codeFence(prettyArguments(entry.arguments), "json"),
              ].join("\n")}
            />
          }
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Arguments" content={entry.arguments} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
