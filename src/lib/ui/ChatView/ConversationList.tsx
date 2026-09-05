import { Action, ActionPanel, Alert, confirmAlert, Icon, List, useNavigation } from "@raycast/api";
import * as React from "react";
import { Conversation, deleteConversation, listConversations } from "../../chat/history";

/**
 * The saved conversations, and the only consumer of the history store.
 *
 * Without this the store was write-only: every turn was persisted and nothing
 * could ever read it back.
 */
export function ConversationList(props: { onSelect: (conversation: Conversation) => void }): React.JSX.Element {
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const { pop } = useNavigation();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await listConversations();
      if (!cancelled) {
        setConversations(saved);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(conversation: Conversation) {
    const confirmed = await confirmAlert({
      title: `Delete “${conversation.title}”?`,
      message: "This cannot be undone.",
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    await deleteConversation(conversation.id);
    setConversations((prev) => prev.filter((c) => c.id !== conversation.id));
  }

  return (
    <List isLoading={loading} searchBarPlaceholder="Search conversations…">
      <List.EmptyView icon={Icon.SpeechBubble} title="No saved conversations" description="Ask something first." />
      {conversations.map((c) => (
        <List.Item
          key={c.id}
          title={c.title}
          subtitle={c.model}
          icon={Icon.SpeechBubble}
          accessories={[{ text: `${c.messages.length} messages` }, { date: new Date(c.updatedAt) }]}
          actions={
            <ActionPanel>
              <Action
                title="Resume"
                icon={Icon.ArrowRight}
                onAction={() => {
                  props.onSelect(c);
                  pop();
                }}
              />
              <Action
                title="Delete"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={() => remove(c)}
                shortcut={{ modifiers: ["ctrl"], key: "x" }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
