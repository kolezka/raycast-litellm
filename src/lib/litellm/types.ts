/**
 * Public type contract for the LiteLLM client.
 *
 * Types only — no runtime code. The implementation lands in Phase 1; these
 * declarations are the interface the UI layer is written against.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON exactly as the model produced it. Parsed by the caller, never trusted. */
  arguments: string;
}

export interface AssistantMessage {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
}

/** A single image attachment, carried as a base64 data URI in an `image_url` part. */
export interface ChatImage {
  /** `data:image/png;base64,...` */
  dataUri: string;
  mimeType: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present only for vision commands; ignored by models without vision support. */
  images?: ChatImage[];
  /** Set on an assistant message that requested tools. */
  toolCalls?: ToolCall[];
  /** Set on a `tool` message, matching the call it answers. */
  toolCallId?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * One streamed increment.
 *
 * `reasoning` carries `delta.reasoning_content`, which reasoning models emit
 * *instead of* `delta.content` while thinking. Consumers that render only
 * `content` show an empty answer for the entire thinking phase, so the two are
 * kept separate rather than concatenated.
 */
export interface ChatChunk {
  content: string;
  reasoning: string;
  done: boolean;
  /** Populated on the final chunk when the proxy reports usage. */
  usage?: TokenUsage;
}

/** Mode reported by `/model/info` — embedding models are excluded from chat pickers. */
export type ModelMode = "chat" | "embedding" | "image_generation" | "rerank" | "unknown";

export interface ChatModel {
  /** Model group name, as passed in the `model` request field. */
  id: string;
  provider?: string;
  mode: ModelMode;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
}

/**
 * Failure kinds the UI distinguishes.
 *
 * `NoHealthyDeployment` is its own kind because `/v1/models` advertises model
 * groups that have no healthy deployment behind them; using one returns HTTP
 * 400 rather than a 404, and the message names the group.
 */
export type LiteLLMErrorKind =
  | "NoHealthyDeployment"
  /** The proxy rejected the key this extension sent. The user can fix it. */
  | "Unauthorized"
  /** The proxy accepted our key, then its own provider credential was rejected upstream. */
  | "UpstreamUnauthorized"
  | "RateLimit"
  | "Timeout"
  | "NetworkUnreachable"
  | "BadRequest"
  | "Unknown";

export interface LiteLLMErrorShape {
  kind: LiteLLMErrorKind;
  /** Message from the proxy, surfaced verbatim — never replaced with a generic string. */
  message: string;
  httpStatus?: number;
  /** The model group involved, when the proxy names one. */
  model?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Abort signal wired to Raycast's view lifecycle so navigating away cancels the stream. */
  signal?: AbortSignal;
  /** Offering tools forces the non-streaming path; see the plan's constraints. */
  tools?: ToolDefinition[];
}

export interface LiteLLMConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

/**
 * The extension's preferences.
 *
 * Raycast generates a global `Preferences` type, but only after `ray build`
 * registers the extension, which cannot happen until the manifest declares a
 * command in Task 6. Declaring the shape here keeps earlier tasks typecheckable
 * and states plainly what the code reads.
 */
export interface ExtensionPreferences {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  requestTimeout?: string;
  chatHistoryMessages?: string;
  resultViewInput?: string;
  resultViewInputFallback?: boolean;
  agentMaxIterations?: string;
  agentWriteTools?: boolean;
  agentShellAllowlist?: string;
}

/** The client surface consumed by the UI layer. */
export interface LiteLLMClient {
  chat(request: ChatRequest): AsyncGenerator<ChatChunk, void, undefined>;
  /** Non-streaming completion. The only path that reliably returns tool calls. */
  complete(request: ChatRequest): Promise<AssistantMessage>;
  /** Chat-capable models, sourced from `/model/info` with a `/v1/models` fallback. */
  listChatModels(signal?: AbortSignal): Promise<ChatModel[]>;
}
