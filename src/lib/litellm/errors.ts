import { LiteLLMErrorKind, LiteLLMErrorShape } from "./types";

export class LiteLLMError extends Error implements LiteLLMErrorShape {
  readonly kind: LiteLLMErrorKind;
  readonly httpStatus?: number;
  readonly model?: string;

  constructor(shape: LiteLLMErrorShape) {
    super(shape.message);
    this.name = "LiteLLMError";
    this.kind = shape.kind;
    this.httpStatus = shape.httpStatus;
    this.model = shape.model;
  }
}

/** Pull the proxy's own message out of an SDK error, falling back to the raw text. */
function extractMessage(err: { message?: string }): string {
  const raw = err.message ?? "";
  try {
    const parsed = JSON.parse(raw);
    const nested = parsed?.error?.message;
    if (typeof nested === "string") return nested;
  } catch {
    // not JSON — the raw message is the best we have
  }
  return raw;
}

/** Observed shape: "... Received Model Group=<name>\nAvailable Model Group Fallbacks=None" */
function modelGroup(message: string): string | undefined {
  return /Received Model Group=([^\s\n]+)/.exec(message)?.[1];
}

export function classifyError(err: unknown): LiteLLMError {
  if (err instanceof LiteLLMError) return err;

  if (typeof err !== "object" || err === null) {
    return new LiteLLMError({ kind: "Unknown", message: String(err) });
  }

  const e = err as { message?: string; name?: string; status?: number };
  const message = extractMessage(e);
  const status = e.status;

  // Timeout message pattern applies only when status is absent or in the 5xx family (408, 504).
  const statusAllowsTimeout = !status || status === 408 || status === 504;

  // AbortError maps to Timeout by name alone, regardless of status. AbortSignal.timeout()
  // aborts with a DOMException named TimeoutError, not AbortError — verified on this
  // machine's Node — so it needs the same by-name treatment or it falls through to the
  // message-pattern check below and misclassifies whenever the message doesn't mention "timeout".
  if (e.name === "AbortError" || e.name === "TimeoutError" || (statusAllowsTimeout && /timed? ?out/i.test(message))) {
    return new LiteLLMError({ kind: "Timeout", message, httpStatus: status });
  }

  if (err instanceof TypeError && /fetch failed|network/i.test(message)) {
    return new LiteLLMError({ kind: "NetworkUnreachable", message });
  }

  // NoHealthyDeployment applies only to 400 status (documented in types.ts).
  if (status === 400 && /no healthy deployments/i.test(message)) {
    return new LiteLLMError({ kind: "NoHealthyDeployment", message, httpStatus: status, model: modelGroup(message) });
  }

  switch (status) {
    case 401:
    case 403: {
      // The proxy names a model group only once it has authenticated the caller
      // and routed the request, so a 401 carrying one is the provider's key
      // being refused, not ours. Both arrive as 401 and only this distinguishes
      // them; conflated, the view tells the user to fix an API key preference
      // that was never wrong.
      const model = modelGroup(message);
      if (model) return new LiteLLMError({ kind: "UpstreamUnauthorized", message, httpStatus: status, model });
      return new LiteLLMError({ kind: "Unauthorized", message, httpStatus: status });
    }
    case 429:
      return new LiteLLMError({ kind: "RateLimit", message, httpStatus: status });
    case 400:
      return new LiteLLMError({ kind: "BadRequest", message, httpStatus: status });
    default:
      return new LiteLLMError({ kind: "Unknown", message, httpStatus: status });
  }
}
