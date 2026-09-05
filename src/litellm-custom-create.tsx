import { Action, ActionPanel, Form, popToRoot, showToast, Toast } from "@raycast/api";
import * as React from "react";
import { createClient } from "./lib/litellm/client";
import { getConfig } from "./lib/litellm/config";
import { ChatModel } from "./lib/litellm/types";
import { Creativity } from "./lib/enums";
import { saveCustomCommand, validateCustomCommand } from "./lib/custom/storage";

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
        // The model list is a convenience here, not a requirement: a command
        // saved with no model falls back to the default at run time, so a proxy
        // that cannot be reached must not block writing the prompt down.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function submit(values: { name: string; prompt: string; model: string; creativity: string }) {
    const problem = validateCustomCommand(values);
    if (problem) {
      await showToast({ style: Toast.Style.Failure, title: problem });
      return;
    }

    await saveCustomCommand({
      id: `cc-${Date.now()}`,
      name: values.name.trim(),
      prompt: values.prompt,
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
          <Action.SubmitForm title="Save Command" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Name" placeholder="Rewrite as a changelog entry" />
      <Form.TextArea
        id="prompt"
        title="Prompt"
        placeholder="Rewrite the following as a changelog entry:&#10;&#10;{selection}"
        info="Must contain {selection}, which is replaced with the selected text or clipboard contents."
      />
      <Form.Dropdown id="model" title="Model" info="Leave on Default to use the Default Model preference.">
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
