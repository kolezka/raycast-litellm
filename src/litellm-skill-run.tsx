import { Action, ActionPanel, Alert, confirmAlert, Icon, List, useNavigation } from "@raycast/api";
import * as React from "react";
import { AgentView } from "./lib/ui/AgentView/main";
import { deleteSkill, listSkills, Skill } from "./lib/agent/skills";
import { ALL_TOOLS, findTool } from "./lib/agent/registry";

export default function Command(): React.JSX.Element {
  const [skills, setSkills] = React.useState<Skill[]>([]);
  const [loading, setLoading] = React.useState(true);
  const { push } = useNavigation();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await listSkills();
      if (!cancelled) {
        setSkills(saved);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(skill: Skill) {
    const confirmed = await confirmAlert({
      title: `Delete ${skill.name}?`,
      message: "This cannot be undone.",
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    await deleteSkill(skill.id);
    setSkills((prev) => prev.filter((s) => s.id !== skill.id));
  }

  return (
    <List isLoading={loading}>
      <List.EmptyView icon={Icon.Stars} title="No skills yet" description="Run Create Skill to define one." />
      {skills.map((s) => {
        // filterTools (registry.ts) silently drops any allowed name it can't match,
        // so a skill saved before a tool was renamed or removed would otherwise run
        // with a quietly smaller capability set and no signal to anyone. The registry
        // only changes after a skill is stored, so this can't be caught at create
        // time — it has to be checked here, every time the list is shown.
        const unknownTools = s.tools.filter((name) => !findTool(ALL_TOOLS, name));
        const accessories: List.Item.Accessory[] = [];
        if (s.model) accessories.push({ text: s.model });
        if (unknownTools.length > 0) {
          accessories.push({
            icon: Icon.Warning,
            text: `Unknown: ${unknownTools.join(", ")}`,
            tooltip: `These tools no longer exist and will be silently skipped: ${unknownTools.join(", ")}`,
          });
        }
        return (
          <List.Item
            key={s.id}
            title={s.name}
            subtitle={s.tools.join(", ")}
            icon={Icon.Stars}
            accessories={accessories.length > 0 ? accessories : undefined}
            actions={
              <ActionPanel>
                <Action title="Run" icon={Icon.ArrowRight} onAction={() => push(<AgentView skill={s} />)} />
                <Action
                  title="Delete"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => remove(s)}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
