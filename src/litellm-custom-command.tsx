import { Action, ActionPanel, Alert, confirmAlert, Icon, List, useNavigation } from "@raycast/api";
import * as React from "react";
import { AnswerView } from "./lib/ui/AnswerView/main";
import { CommandName } from "./lib/enums";
import { CustomCommand, deleteCustomCommand, listCustomCommands } from "./lib/custom/storage";

export default function Command(): React.JSX.Element {
  const [commands, setCommands] = React.useState<CustomCommand[]>([]);
  const [loading, setLoading] = React.useState(true);
  const { push } = useNavigation();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await listCustomCommands();
      if (!cancelled) {
        setCommands(saved);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(command: CustomCommand) {
    const confirmed = await confirmAlert({
      title: `Delete ${command.name}?`,
      message: "This cannot be undone.",
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    await deleteCustomCommand(command.id);
    setCommands((prev) => prev.filter((c) => c.id !== command.id));
  }

  return (
    <List isLoading={loading}>
      <List.EmptyView
        icon={Icon.Stars}
        title="No custom commands yet"
        description="Run Create Custom Command to define one."
      />
      {commands.map((c) => (
        <List.Item
          key={c.id}
          title={c.name}
          subtitle={c.model}
          icon={Icon.Stars}
          actions={
            <ActionPanel>
              <Action
                title="Run"
                icon={Icon.ArrowRight}
                onAction={() =>
                  push(
                    <AnswerView
                      command={CommandName.CUSTOM}
                      prompt={c.prompt}
                      creativity={c.creativity}
                      model={c.model}
                    />,
                  )
                }
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
