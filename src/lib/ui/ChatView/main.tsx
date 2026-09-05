import {
  Action,
  ActionPanel,
  Icon,
  List,
  showToast,
  Toast,
  getPreferenceValues,
  useNavigation,
  Keyboard,
} from "@raycast/api";
import * as React from "react";
import { createClient } from "../../litellm/client";
import { getConfig } from "../../litellm/config";
import { LiteLLMError } from "../../litellm/errors";
import { ChatMessage, ChatModel, ExtensionPreferences } from "../../litellm/types";
import { CommandName } from "../../enums";
import { resolveModel, setCommandModel } from "../../settings";
import {
  Conversation,
  conversationTitle,
  parseHistoryLimit,
  saveConversation,
  windowMessages,
} from "../../chat/history";
import { ConversationList } from "./ConversationList";
import { ModelDropdown } from "../ModelDropdown";

function asLiteLLMError(err: unknown): LiteLLMError {
  return err instanceof LiteLLMError ? err : new LiteLLMError({ kind: "Unknown", message: String(err) });
}

export function ChatView(): React.JSX.Element {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [models, setModels] = React.useState<ChatModel[]>([]);
  const [model, setModel] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [reasoning, setReasoning] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const conversationId = React.useRef(`c-${Date.now()}`);
  const { push } = useNavigation();

  // A stream outlives the view unless something stops it: navigating away mid
  // reply would otherwise keep consuming chunks and setting state on a view
  // that is gone. Held in a ref so unmount can reach the in-flight request.
  const inFlight = React.useRef<AbortController | undefined>(undefined);
  React.useEffect(() => () => inFlight.current?.abort(), []);

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const client = createClient(getConfig());
        const available = await client.listChatModels(controller.signal);
        if (controller.signal.aborted) return;
        setModels(available);
        setModel((await resolveModel(CommandName.CHAT)) || available[0]?.id || "");
      } catch (err) {
        if (controller.signal.aborted) return;
        const e = asLiteLLMError(err);
        await showToast({ style: Toast.Style.Failure, title: e.kind, message: e.message });
      }
    })();
    return () => controller.abort();
  }, []);

  async function submit() {
    const text = query.trim();
    if (!text || loading) return;
    setQuery("");
    setReasoning("");

    const limit = parseHistoryLimit(getPreferenceValues<ExtensionPreferences>().chatHistoryMessages);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMessages(next);
    setLoading(true);

    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const client = createClient(getConfig());
      for await (const chunk of client.chat({
        model,
        messages: windowMessages(next.slice(0, -1), limit),
        signal: controller.signal,
      })) {
        setReasoning(chunk.reasoning);
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: chunk.content };
          return copy;
        });
      }

      const conversation: Conversation = {
        id: conversationId.current,
        title: conversationTitle(next),
        model,
        messages: next,
        updatedAt: Date.now(),
      };
      await saveConversation(conversation);
    } catch (err) {
      if (controller.signal.aborted) return;
      const e = asLiteLLMError(err);
      await showToast({ style: Toast.Style.Failure, title: e.kind, message: e.message });
      // Roll back the pair this turn added, and give the user their words back:
      // the search bar was cleared on submit, so dropping the message without
      // restoring it loses everything they typed.
      setMessages((prev) => prev.slice(0, -2));
      setQuery(text);
    } finally {
      if (inFlight.current === controller) inFlight.current = undefined;
      setLoading(false);
    }
  }

  function resume(conversation: Conversation) {
    inFlight.current?.abort();
    conversationId.current = conversation.id;
    setMessages(conversation.messages);
    setModel(conversation.model);
    setReasoning("");
  }

  function startNew() {
    inFlight.current?.abort();
    conversationId.current = `c-${Date.now()}`;
    setMessages([]);
    setReasoning("");
    setQuery("");
  }

  const send = <Action title="Send" icon={Icon.ArrowRight} onAction={submit} />;
  const history = (
    <>
      <Action
        title="Conversation History"
        icon={Icon.Clock}
        shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
        onAction={() => push(<ConversationList onSelect={resume} />)}
      />
      <Action title="New Conversation" icon={Icon.Plus} shortcut={Keyboard.Shortcut.Common.New} onAction={startNew} />
    </>
  );

  return (
    <List
      isLoading={loading}
      isShowingDetail={messages.length > 0}
      searchText={query}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Ask anything…"
      searchBarAccessory={
        <ModelDropdown
          models={models}
          value={model}
          onChange={async (m) => {
            setModel(m);
            await setCommandModel(CommandName.CHAT, m);
          }}
        />
      }
      actions={
        <ActionPanel>
          {send}
          {history}
        </ActionPanel>
      }
    >
      {messages.map((m, i) => (
        <List.Item
          key={i}
          title={m.content.slice(0, 60) || "…"}
          icon={m.role === "user" ? Icon.Person : Icon.Stars}
          detail={
            <List.Item.Detail
              markdown={
                m.role === "assistant" && reasoning && i === messages.length - 1
                  ? `> _Reasoning_\n>\n${reasoning.replace(/^/gm, "> ")}\n\n${m.content}`
                  : m.content
              }
            />
          }
          actions={
            <ActionPanel>
              {send}
              <Action.CopyToClipboard title="Copy Message" content={m.content} />
              {history}
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
