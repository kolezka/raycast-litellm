import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { parseModelInfo, parseModelsList, fetchChatModels } from "../src/lib/litellm/models";
import { LiteLLMConfig } from "../src/lib/litellm/types";

const modelInfo = {
  data: [
    {
      model_name: "deepseek/deepseek-chat",
      litellm_params: { model: "deepseek/deepseek-chat" },
      model_info: { mode: "chat", max_input_tokens: 65536, max_output_tokens: 8192, supports_vision: false },
    },
    {
      model_name: "gpt-4o",
      litellm_params: { model: "openai/gpt-4o" },
      model_info: { mode: "chat", max_input_tokens: 128000, supports_vision: true, supports_function_calling: true },
    },
    {
      model_name: "bge-m3",
      litellm_params: { model: "ollama/bge-m3" },
      model_info: { mode: "embedding" },
    },
  ],
};

describe("parseModelInfo", () => {
  it("keeps only chat models", () => {
    const models = parseModelInfo(modelInfo);
    expect(models.map((m) => m.id)).toEqual(["deepseek/deepseek-chat", "gpt-4o"]);
  });

  it("carries capability metadata", () => {
    const gpt = parseModelInfo(modelInfo).find((m) => m.id === "gpt-4o");
    expect(gpt?.supportsVision).toBe(true);
    expect(gpt?.supportsFunctionCalling).toBe(true);
    expect(gpt?.contextWindow).toBe(128000);
  });

  it("defaults missing capability flags to false", () => {
    const ds = parseModelInfo(modelInfo).find((m) => m.id === "deepseek/deepseek-chat");
    expect(ds?.supportsVision).toBe(false);
    expect(ds?.supportsFunctionCalling).toBe(false);
  });

  it("returns an empty list for a malformed payload", () => {
    expect(parseModelInfo({ nope: true })).toEqual([]);
  });
});

describe("parseModelsList", () => {
  it("drops wildcard entries and marks the mode unknown", () => {
    const models = parseModelsList({
      data: [{ id: "gpt-4o" }, { id: "deepseek/*" }, { id: "deepseek/deepseek-chat" }],
    });
    expect(models.map((m) => m.id)).toEqual(["gpt-4o", "deepseek/deepseek-chat"]);
    expect(models[0].mode).toBe("unknown");
  });

  it("returns an empty list for a malformed payload", () => {
    expect(parseModelsList({ nope: true })).toEqual([]);
  });
});

describe("fetchChatModels", () => {
  const cfg: LiteLLMConfig = {
    baseUrl: "https://proxy.example.com",
    apiKey: "test-key",
    timeoutMs: 5000,
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns /model/info result when successful, even if empty", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    const models = await fetchChatModels(cfg);

    expect(models).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain("/model/info");
  });

  it("falls back to /v1/models when /model/info returns 401", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unauthorized" } }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), {
          status: 200,
        }),
      );

    const models = await fetchChatModels(cfg);

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("gpt-4o");
    expect(models[0].mode).toBe("unknown");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("propagates non-Unauthorized errors from /model/info without falling back", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Internal server error" } }), { status: 500 }),
    );

    await expect(fetchChatModels(cfg)).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain("/model/info");
  });
});
