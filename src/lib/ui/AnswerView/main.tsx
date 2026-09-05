import { Action, ActionPanel, Detail, Icon, openExtensionPreferences, showToast, Toast } from "@raycast/api";
import * as React from "react";
import { createClient } from "../../litellm/client";
import { getConfig } from "../../litellm/config";
import { LiteLLMError } from "../../litellm/errors";
import { ChatImage, ChatModel } from "../../litellm/types";
import { CommandName, Creativity } from "../../enums";
import { resolveModel, setCommandModel } from "../../settings";
import { fillPlaceholders } from "../../prompts";
import { getCommandInput } from "../input";

interface Props {
  command: CommandName;
  prompt: string;
  creativity?: Creativity;
  /** Overrides input acquisition; used by the custom-command runner. */
  input?: string;
  /**
   * Which placeholder the input fills. Defaults to `selection`.
   *
   * Summarize Website ports a prompt written against `{browser-tab}`, and its
   * input is page text rather than a selection. Without this, that prompt would
   * keep its `{browser-tab}` unfilled and the model would be asked to summarize
   * an empty website.
   */
  inputPlaceholder?: "selection" | "browser-tab";
  /**
   * Model to use, overriding the per-command setting.
   *
   * Every custom command shares one `CommandName.CUSTOM` storage key, so the
   * model saved on a custom command has to travel with it. Without this, that
   * saved model is written by the creation form and never read, and changing
   * the model on one custom command changes it for all of them — the upstream
   * key-sharing bug `CommandName` documents refusing to reproduce.
   */
  model?: string;
  /**
   * Images to send alongside the prompt.
   *
   * Supplying these also satisfies the view's input requirement: a vision
   * command has no text selection to acquire, and without this the run effect
   * would wait forever for input that never arrives.
   */
  images?: ChatImage[];
}

function errorHint(e: LiteLLMError): string {
  switch (e.kind) {
    case "NoHealthyDeployment":
      return `Model group \`${e.model ?? "unknown"}\` has no healthy deployment. Pick another model.`;
    case "Unauthorized":
      return "The proxy rejected the API key. Check the LiteLLM API Key preference.";
    case "UpstreamUnauthorized":
      return `Model group \`${e.model ?? "unknown"}\` is configured on the proxy, but the provider key behind it was rejected. Your LiteLLM API Key is fine — pick another model, or fix that group on the proxy.`;
    case "NetworkUnreachable":
      return "Could not reach the proxy. Check the LiteLLM Base URL preference.";
    case "RateLimit":
      return "Rate limited by the proxy or the upstream provider.";
    case "Timeout":
      return "The request timed out. Raise the Request Timeout preference.";
    default:
      return "";
  }
}

export function AnswerView(props: Props): React.JSX.Element {
  const [answer, setAnswer] = React.useState("");
  const [reasoning, setReasoning] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | undefined>();
  const [model, setModel] = React.useState("");
  const [models, setModels] = React.useState<ChatModel[]>([]);
  const [runId, setRunId] = React.useState(0);
  const [autoPicked, setAutoPicked] = React.useState(false);
  const [input, setInput] = React.useState<string | undefined>(props.input);

  // Acquire the input ONCE, on mount — not inside the run effect. Retry and
  // "Change Model" both bump runId, and by then the frontmost app's selection
  // may have changed or been lost, so a retry would answer a different question
  // than the one the user invoked the command on.
  //
  // The one exception is a failed acquisition: `input` stays undefined, the run
  // effect early-returns, and Retry would be a permanent no-op. So this effect
  // is keyed on runId and re-attempts only while input is still undefined.
  React.useEffect(() => {
    if (props.input !== undefined) return;
    if (props.images?.length) return;
    if (input !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const text = await getCommandInput();
        if (!cancelled) setInput(text);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, input, props.input]);

  React.useEffect(() => {
    if (input === undefined && !props.images?.length) return;

    const controller = new AbortController();
    // Guards every setter below. Without it, a superseded run's `finally` clears
    // the loading flag while the retried request is still streaming, and its
    // late chunks overwrite the new run's state. openai v7 does not throw on
    // abort — the loop exits normally — so the catch block alone cannot cover this.
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(undefined);
      setAnswer("");
      setReasoning("");

      try {
        const cfg = getConfig();
        if (!cfg.baseUrl || !cfg.apiKey) throw new Error("Set the LiteLLM Base URL and API Key in preferences.");

        const client = createClient(cfg);
        const available = await client.listChatModels(controller.signal);
        if (cancelled) return;
        setModels(available);

        // Whether the model was chosen or merely defaulted to changes what a
        // model-scoped failure means: a proxy can list a model group whose
        // provider key is missing, and `available[0]` lands on it as readily as
        // on a working one. The user cannot act on that without being told the
        // model was never their pick.
        const configured = props.model || (await resolveModel(props.command));
        const chosen = configured || available[0]?.id;
        if (!chosen) throw new Error("The proxy exposes no chat models.");
        if (cancelled) return;
        setAutoPicked(!configured);
        setModel(chosen);

        const prompt = fillPlaceholders(
          props.prompt,
          props.inputPlaceholder === "browser-tab" ? { browserTab: input } : { selection: input },
        );

        for await (const chunk of client.chat({
          model: chosen,
          messages: [{ role: "user", content: prompt, images: props.images }],
          temperature: props.creativity ?? Creativity.Low,
          signal: controller.signal,
        })) {
          if (cancelled) return;
          setAnswer(chunk.content);
          setReasoning(chunk.reasoning);
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        await showToast({
          style: Toast.Style.Failure,
          // A LiteLLM failure gets its kind as the title; a local problem ("No
          // text selected") is not an unknown LiteLLM error and must not be
          // dressed up as one.
          title: e instanceof LiteLLMError ? e.kind : e.message,
          message: e instanceof LiteLLMError ? e.message : undefined,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId, input, props.command, props.prompt, props.creativity, props.model, props.images]);

  let markdown: string;
  if (error instanceof LiteLLMError) {
    const blamesModel = error.kind === "UpstreamUnauthorized" || error.kind === "NoHealthyDeployment";
    const note =
      autoPicked && blamesModel
        ? `\n\n_\`${model}\` was not your choice: no Default Model is set, so the first model the proxy lists was used._`
        : "";
    markdown = `## ${error.kind}\n\n${errorHint(error)}${note}\n\n\`\`\`\n${error.message}\n\`\`\``;
  } else if (error) {
    // A local condition — nothing to quote from the proxy, so no code fence.
    markdown = `## ${error.message}`;
  } else {
    markdown = [reasoning ? `> _Reasoning_\n>\n${reasoning.replace(/^/gm, "> ")}` : "", answer]
      .filter(Boolean)
      .join("\n\n");
  }

  return (
    <Detail
      isLoading={loading}
      markdown={markdown}
      // The only place the active model is visible — resolveModel returns "" when
      // nothing is configured and the caller falls back to available[0].
      navigationTitle={model || undefined}
      actions={
        <ActionPanel>
          {/* Ternaries, not `&&`: `answer && <Action/>` yields "" during the whole
              loading and reasoning phase, and a bare string is not a valid
              ActionPanel child. */}
          {answer ? <Action.CopyToClipboard title="Copy Answer" content={answer} /> : null}
          {answer ? <Action.Paste title="Paste Answer" content={answer} /> : null}
          <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => setRunId((n) => n + 1)} />
          {error ? (
            <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
          ) : null}
          <ActionPanel.Submenu title="Change Model" icon={Icon.Box}>
            {models.map((m) => (
              <Action
                key={m.id}
                title={m.id}
                onAction={async () => {
                  await setCommandModel(props.command, m.id);
                  setRunId((n) => n + 1);
                }}
              />
            ))}
          </ActionPanel.Submenu>
        </ActionPanel>
      }
    />
  );
}
