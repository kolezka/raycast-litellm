import { ChatModel, LiteLLMConfig, ModelMode } from "./types";
import { classifyError } from "./errors";

interface ModelInfoEntry {
  model_name?: string;
  litellm_params?: { model?: string };
  model_info?: {
    mode?: string;
    max_input_tokens?: number;
    max_output_tokens?: number;
    supports_vision?: boolean;
    supports_function_calling?: boolean;
  };
}

function providerOf(litellmModel: string | undefined): string | undefined {
  if (!litellmModel) return undefined;
  const slash = litellmModel.indexOf("/");
  return slash > 0 ? litellmModel.slice(0, slash) : undefined;
}

export function parseModelInfo(payload: unknown): ChatModel[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  return data
    .filter((e: ModelInfoEntry) => e?.model_info?.mode === "chat" && typeof e.model_name === "string")
    .map((e: ModelInfoEntry) => ({
      id: e.model_name as string,
      provider: providerOf(e.litellm_params?.model),
      mode: "chat" as ModelMode,
      contextWindow: e.model_info?.max_input_tokens,
      maxOutputTokens: e.model_info?.max_output_tokens,
      supportsVision: e.model_info?.supports_vision === true,
      supportsFunctionCalling: e.model_info?.supports_function_calling === true,
    }));
}

export function parseModelsList(payload: unknown): ChatModel[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  return data
    .filter((e: { id?: string }) => typeof e?.id === "string" && !e.id.includes("*"))
    .map((e: { id?: string }) => ({
      id: e.id as string,
      provider: providerOf(e.id),
      mode: "unknown" as ModelMode,
      supportsVision: false,
      supportsFunctionCalling: false,
    }));
}

async function getJson(url: string, cfg: LiteLLMConfig, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(cfg.timeoutMs)]) : AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) {
    throw Object.assign(new Error(await res.text()), { status: res.status });
  }
  return res.json();
}

/**
 * Chat-capable models, with two-tier discovery strategy.
 *
 * Primary: `/model/info` is authoritative. It lists configured deployments and
 * carries `mode`, which distinguishes chat from embedding models. Any successful
 * response — even if empty — is returned as-is; the proxy knows which models exist.
 *
 * Fallback: If `/model/info` fails with `Unauthorized` (non-admin key), try
 * `/v1/models`. This endpoint has no mode indicator, so all results are marked
 * `mode: "unknown"` and lack capability metadata. It's weaker but better than
 * no list at all.
 *
 * Any other error from `/model/info` propagates immediately. Any error from
 * the fallback is wrapped and propagated as a `LiteLLMError`.
 */
export async function fetchChatModels(cfg: LiteLLMConfig, signal?: AbortSignal): Promise<ChatModel[]> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  try {
    return parseModelInfo(await getJson(`${base}/model/info`, cfg, signal));
  } catch (err) {
    const classified = classifyError(err);
    if (classified.kind !== "Unauthorized") throw classified;
    // Non-admin key: fall back to the unverified list.
  }
  try {
    return parseModelsList(await getJson(`${base}/v1/models`, cfg, signal));
  } catch (err) {
    throw classifyError(err);
  }
}
