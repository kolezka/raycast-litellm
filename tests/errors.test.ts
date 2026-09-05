import { describe, expect, it } from "vitest";
import { classifyError, LiteLLMError } from "../src/lib/litellm/errors";

const noHealthyBody = {
  error: {
    message:
      "litellm.BadRequestError: You passed in model=deepseek-v4-flash. There are no healthy deployments for this model. Received Model Group=deepseek-v4-flash\nAvailable Model Group Fallbacks=None",
    type: null,
    param: null,
    code: "400",
  },
};

// Both 401 bodies below were captured from a live LiteLLM proxy. They differ in
// whose credential was rejected, and only one of them is the user's problem.
const badClientKeyBody = {
  error: {
    message:
      "Authentication Error, Invalid proxy server token passed. Received API Key = sk-...-key, Key Hash (Token) =<redacted>. Unable to find token in cache or `LiteLLM_VerificationTokenTable`",
    type: "token_not_found_in_db",
    param: "key",
    code: "401",
  },
};

const upstreamKeyMissingBody = {
  error: {
    message:
      "litellm.BadRequestError: OpenAIException - You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY), or as the password field (with blank username) if you're accessing the API from your browser and are prompted for a username and password. You can obtain an API key from https://platform.openai.com/account/api-keys.. Received Model Group=gpt-4\nAvailable Model Group Fallbacks=None",
    type: null,
    param: null,
    code: "401",
  },
};

function apiError(status: number, body: unknown) {
  return Object.assign(new Error(JSON.stringify(body)), { status });
}

describe("classifyError", () => {
  it("maps an unhealthy model group and preserves its name", () => {
    const e = classifyError(apiError(400, noHealthyBody));
    expect(e).toBeInstanceOf(LiteLLMError);
    expect(e.kind).toBe("NoHealthyDeployment");
    expect(e.model).toBe("deepseek-v4-flash");
    expect(e.message).toContain("no healthy deployments");
  });

  it("maps 401 to Unauthorized", () => {
    expect(classifyError(apiError(401, { error: { message: "Invalid key" } })).kind).toBe("Unauthorized");
  });

  // The invariant: a credential the user cannot see or change must never be
  // reported as theirs. A 401 naming a model group was authenticated by the
  // proxy and rejected upstream, so pointing at the API Key preference sends
  // the user to edit a setting that is already correct.
  it("maps a 401 rejecting the client's own key to Unauthorized", () => {
    const e = classifyError(apiError(401, badClientKeyBody));
    expect(e.kind).toBe("Unauthorized");
    expect(e.model).toBeUndefined();
  });

  it("maps a 401 naming a model group to UpstreamUnauthorized and keeps the group", () => {
    const e = classifyError(apiError(401, upstreamKeyMissingBody));
    expect(e.kind).toBe("UpstreamUnauthorized");
    expect(e.model).toBe("gpt-4");
  });

  it("treats a 403 naming a model group the same way", () => {
    expect(classifyError(apiError(403, upstreamKeyMissingBody)).kind).toBe("UpstreamUnauthorized");
  });

  it("maps 429 to RateLimit", () => {
    expect(classifyError(apiError(429, { error: { message: "slow down" } })).kind).toBe("RateLimit");
  });

  it("maps an abort to Timeout", () => {
    const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    expect(classifyError(abort).kind).toBe("Timeout");
  });

  it("maps a fired AbortSignal.timeout to Timeout by name", () => {
    // Message deliberately free of timeout wording: with "timed out" in it the
    // message regex classifies correctly anyway, so the test would pass with or
    // without the name-check fix it exists to pin.
    const e = Object.assign(new Error("signal is aborted without reason"), { name: "TimeoutError" });
    expect(classifyError(e).kind).toBe("Timeout");
  });

  it("maps a fetch failure to NetworkUnreachable", () => {
    expect(classifyError(new TypeError("fetch failed")).kind).toBe("NetworkUnreachable");
  });

  it("maps an unrecognised 400 to BadRequest", () => {
    expect(classifyError(apiError(400, { error: { message: "bad params" } })).kind).toBe("BadRequest");
  });

  it("falls back to Unknown", () => {
    expect(classifyError("something odd").kind).toBe("Unknown");
  });

  describe("priority: HTTP status takes precedence over message patterns", () => {
    it("maps 400 with 'timeout' message to BadRequest, not Timeout", () => {
      expect(
        classifyError(apiError(400, { error: { message: "Invalid value for 'timeout': must be a number" } })).kind,
      ).toBe("BadRequest");
    });

    it("maps 429 with 'no healthy deployments' message to RateLimit, not NoHealthyDeployment", () => {
      expect(classifyError(apiError(429, { error: { message: "No healthy deployments for this model" } })).kind).toBe(
        "RateLimit",
      );
    });

    it("maps a status-less error with 'Request timed out' message to Timeout", () => {
      const err = new Error(JSON.stringify({ error: { message: "Request timed out" } }));
      // No status property set, so status is undefined
      expect(classifyError(err).kind).toBe("Timeout");
    });
  });
});
