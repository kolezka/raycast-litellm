import { getPreferenceValues } from "@raycast/api";
import { ExtensionPreferences, LiteLLMConfig } from "./types";

export function getConfig(): LiteLLMConfig {
  const pref = getPreferenceValues<ExtensionPreferences>();
  const seconds = Number(pref.requestTimeout ?? "60");
  return {
    baseUrl: (pref.baseUrl ?? "").replace(/\/+$/, ""),
    apiKey: pref.apiKey ?? "",
    timeoutMs: (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000,
  };
}
