import { Action, ActionPanel, Alert, confirmAlert, Icon, List, getPreferenceValues, useNavigation } from "@raycast/api";
import * as React from "react";
import { createClient } from "../../litellm/client";
import { getConfig } from "../../litellm/config";
import { LiteLLMError } from "../../litellm/errors";
import { ChatMessage, ChatModel, ExtensionPreferences } from "../../litellm/types";
import { CommandName, Creativity } from "../../enums";
import { resolveModel, setCommandModel } from "../../settings";
import { ModelDropdown } from "../ModelDropdown";
import { AgentStep, runAgent, tookOutsideContent } from "../../agent/loop";
import { ALL_TOOLS, filterTools, findTool } from "../../agent/registry";
import { decide, Decision, parseAllowlist } from "../../agent/permissions";
import { appendAudit } from "../../agent/audit";
import { resolveTemperature } from "../../agent/skills";
import { describeArgumentsFallback } from "../../agent/display";
import { Tool } from "../../agent/types";
import { codeFence } from "../markdown";
import { AuditLog } from "./AuditLog";

const ICONS: Record<AgentStep["kind"], Icon> = {
  assistant: Icon.Stars,
  tool_call: Icon.Hammer,
  tool_result: Icon.CheckCircle,
  error: Icon.Warning,
};

export function AgentView(props: {
  skill?: { instructions: string; tools: string[]; model?: string; creativity: Creativity };
}) {
  const [steps, setSteps] = React.useState<AgentStep[]>([]);
  const [models, setModels] = React.useState<ChatModel[]>([]);
  const [model, setModel] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const history = React.useRef<ChatMessage[]>([]);
  const inFlight = React.useRef<AbortController | undefined>(undefined);
  const { push } = useNavigation();

  // Identifies this view's run in the audit log (spec: "tool, arguments,
  // decision, timestamp, conversation id"), the same way ChatView's
  // conversationId identifies a saved conversation — generated once and held
  // for the life of the view rather than per submit(), so every turn of one
  // agent run is attributed to the same id.
  const conversationId = React.useRef(`agent-${Date.now()}`);

  // Session state the permission rules need but must not own: once untrusted
  // content arrives it never clears, and a remembered read approval dies with it.
  const tainted = React.useRef(false);
  const readLocalApproved = React.useRef(false);

  React.useEffect(() => () => inFlight.current?.abort(), []);

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const available = await createClient(getConfig()).listChatModels(controller.signal);
        if (controller.signal.aborted) return;
        setModels(available);
        setModel(props.skill?.model || (await resolveModel(CommandName.AGENT)) || available[0]?.id || "");
      } catch {
        // Model discovery failing is reported when the first run is attempted.
      }
    })();
    return () => controller.abort();
  }, []);

  async function permit(tool: Tool, input: Record<string, unknown>) {
    const pref = getPreferenceValues<ExtensionPreferences>();
    const verdict = decide({
      risk: tool.risk,
      tainted: tainted.current,
      writeToolsEnabled: pref.agentWriteTools === true,
      shellAllowlist: parseAllowlist(pref.agentShellAllowlist),
      readLocalApproved: readLocalApproved.current,
      command: typeof input.command === "string" ? input.command : undefined,
    });

    let allowed = verdict === "allow";
    // Distinct from `verdict`: audit must tell a policy refusal (no dialog
    // ever shown) apart from the user declining a dialog that was shown.
    let decision: Decision | "denied-by-user" = verdict;
    if (verdict === "ask") {
      // A tool's own description of its real effect, when it has one —
      // e.g. a resolved, symlink-followed path — rather than the model's
      // raw arguments, which can name something other than what actually
      // happens. Falls back to a capped, escaped rendering of the raw
      // arguments for tools with no stake in the distinction (nothing they
      // do can diverge from their arguments) — never the model's own
      // JSON.stringify key order and uncapped values, which let a single
      // padded argument push every other one off the bottom of the dialog.
      const message = (await tool.describe?.(input)) ?? describeArgumentsFallback(input);
      allowed = await confirmAlert({
        title: `Run ${tool.definition.name}?`,
        message: [
          message,
          tainted.current ? "\nThis conversation contains content fetched from outside — check it." : "",
        ].join("\n"),
        primaryAction: { title: "Run", style: Alert.ActionStyle.Destructive },
      });
      decision = allowed ? "ask" : "denied-by-user";
      if (allowed && tool.risk === "read_local") readLocalApproved.current = true;
    }

    await appendAudit({
      at: Date.now(),
      tool: tool.definition.name,
      arguments: JSON.stringify(input),
      decision,
      conversationId: conversationId.current,
    });

    return allowed ? "allow" : "deny";
  }

  async function submit() {
    const text = query.trim();
    if (!text || running) return;
    setQuery("");
    setRunning(true);

    const controller = new AbortController();
    inFlight.current = controller;
    const tools = props.skill ? filterTools(ALL_TOOLS, props.skill.tools) : ALL_TOOLS;

    if (history.current.length === 0 && props.skill) {
      history.current.push({ role: "system", content: props.skill.instructions });
    }
    history.current.push({ role: "user", content: text });

    try {
      for await (const step of runAgent({
        client: createClient(getConfig()),
        model,
        messages: history.current,
        tools,
        maxIterations: Number(getPreferenceValues<ExtensionPreferences>().agentMaxIterations ?? "10") || 10,
        permit,
        temperature: resolveTemperature(props.skill),
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) return;
        setSteps((prev) => [...prev, step]);
        if (step.kind === "assistant") history.current.push({ role: "assistant", content: step.text });
        // Taint reflects what the conversation actually received, not merely
        // what was approved — but a call that ran and *threw* still counts:
        // web_fetch embeds a redirect target or a response header, run_shell
        // embeds stderr, and none of that stops being outside content just
        // because the call ended in an exception. tookOutsideContent keys off
        // `ran`, not `failed`, for exactly that reason.
        if (tookOutsideContent(step, findTool(ALL_TOOLS, step.toolName ?? ""))) {
          tainted.current = true;
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const e = err instanceof LiteLLMError ? err : new LiteLLMError({ kind: "Unknown", message: String(err) });
      setSteps((prev) => [...prev, { kind: "error", text: `${e.kind}: ${e.message}` }]);
    } finally {
      if (inFlight.current === controller) inFlight.current = undefined;
      setRunning(false);
    }
  }

  const run = <Action title="Run" icon={Icon.ArrowRight} onAction={submit} />;
  const stop = <Action title="Stop" icon={Icon.Stop} onAction={() => inFlight.current?.abort()} />;
  // Reachable from every list state, not just once results exist: the audit
  // log is what shows what happened, so it needs to still be there before
  // anything has run yet (e.g. to check a previous run's history).
  const viewAuditLog = (
    <Action
      title="View Audit Log"
      icon={Icon.List}
      shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
      onAction={() => push(<AuditLog />)}
    />
  );

  return (
    <List
      isLoading={running}
      isShowingDetail={steps.length > 0}
      searchText={query}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="What should the agent do?"
      searchBarAccessory={
        <ModelDropdown
          models={models}
          value={model}
          onChange={async (m) => {
            setModel(m);
            await setCommandModel(CommandName.AGENT, m);
          }}
        />
      }
      actions={
        <ActionPanel>
          {run}
          {stop}
          {viewAuditLog}
        </ActionPanel>
      }
    >
      {steps.map((step, i) => (
        <List.Item
          key={i}
          icon={ICONS[step.kind]}
          title={step.toolName ?? step.kind}
          subtitle={step.text.replace(/\s+/g, " ").slice(0, 60)}
          accessories={step.decision ? [{ text: step.decision }] : undefined}
          // step.text can be tool output the model chose to include (a file's
          // contents, a shell command's stdout); a stray "```" inside it would
          // otherwise close this fence early and let the rest render as markdown.
          detail={<List.Item.Detail markdown={codeFence(step.text)} />}
          actions={
            <ActionPanel>
              {run}
              <Action.CopyToClipboard title="Copy Step" content={step.text} />
              {stop}
              {viewAuditLog}
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
