import { Action, ActionPanel, Form, popToRoot, showToast, Toast } from "@raycast/api";
import * as React from "react";
import { createClient } from "./lib/litellm/client";
import { getConfig } from "./lib/litellm/config";
import { ChatModel } from "./lib/litellm/types";
import { Creativity } from "./lib/enums";
import { ALL_TOOLS } from "./lib/agent/registry";
import { saveSkill, validateSkill } from "./lib/agent/skills";

const CREATIVITY_OPTIONS: { title: string; value: Creativity }[] = [
  { title: "None", value: Creativity.None },
  { title: "Low", value: Creativity.Low },
  { title: "Medium", value: Creativity.Medium },
  { title: "High", value: Creativity.High },
  { title: "Maximum", value: Creativity.Maximum },
];

export default function Command(): React.JSX.Element {
  const [models, setModels] = React.useState<ChatModel[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const available = await createClient(getConfig()).listChatModels(controller.signal);
        if (!controller.signal.aborted) setModels(available);
      } catch {
        // The dropdown is a convenience; a skill saved without a model uses the default.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function submit(values: {
    name: string;
    instructions: string;
    tools: string[];
    model: string;
    creativity: string;
  }) {
    const problem = validateSkill(values);
    if (problem) {
      await showToast({ style: Toast.Style.Failure, title: problem });
      return;
    }
    await saveSkill({
      id: `sk-${Date.now()}`,
      name: values.name.trim(),
      instructions: values.instructions,
      tools: values.tools,
      model: values.model || undefined,
      creativity: Number(values.creativity) as Creativity,
    });
    await showToast({ style: Toast.Style.Success, title: `Saved ${values.name.trim()}` });
    await popToRoot();
  }

  return (
    <Form
      isLoading={loading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Skill" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Name" placeholder="Release note writer" />
      <Form.TextArea
        id="instructions"
        title="Instructions"
        placeholder="You write release notes. Search for the linked issues before summarising."
      />
      <Form.TagPicker id="tools" title="Tools" info="The skill can use only these.">
        {ALL_TOOLS.map((t) => (
          <Form.TagPicker.Item
            key={t.definition.name}
            value={t.definition.name}
            title={`${t.definition.name} (${t.risk})`}
          />
        ))}
      </Form.TagPicker>
      <Form.Dropdown id="model" title="Model">
        <Form.Dropdown.Item title="Default" value="" />
        {models.map((m) => (
          <Form.Dropdown.Item key={m.id} title={m.id} value={m.id} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="creativity" title="Creativity" defaultValue={String(Creativity.Low)}>
        {CREATIVITY_OPTIONS.map((o) => (
          <Form.Dropdown.Item key={o.title} title={o.title} value={String(o.value)} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}
