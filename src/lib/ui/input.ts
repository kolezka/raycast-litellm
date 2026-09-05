import { Clipboard, getPreferenceValues, getSelectedText } from "@raycast/api";
import type { ExtensionPreferences } from "../litellm/types";

async function trySelectedText(): Promise<{ text: string; error?: Error }> {
  try {
    return { text: (await getSelectedText()) ?? "" };
  } catch (err) {
    // Raycast throws here both when nothing is selected and when Accessibility
    // permission is denied, and its error strings are not documented. Rather
    // than guess which is which, carry the message forward and surface it if no
    // input can be found at all — the user sees the real cause either way.
    return { text: "", error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Text a transformation command operates on, honouring the input-source
 * preference and its optional fallback. Throws when nothing is available so the
 * view can say so instead of prompting an empty model call.
 */
export async function getCommandInput(): Promise<string> {
  const pref = getPreferenceValues<ExtensionPreferences>();
  const preferSelection = pref.resultViewInput !== "clipboard";
  let selectionError: Error | undefined;

  const read = async (fromSelection: boolean): Promise<string> => {
    if (!fromSelection) return (await Clipboard.readText()) ?? "";
    const { text, error } = await trySelectedText();
    if (error) selectionError = error;
    return text;
  };

  const primary = await read(preferSelection);
  if (primary.trim()) return primary;

  if (pref.resultViewInputFallback) {
    const secondary = await read(!preferSelection);
    if (secondary.trim()) return secondary;
  }

  const base = preferSelection ? "No text selected" : "Clipboard is empty";
  throw new Error(selectionError ? `${base} (${selectionError.message})` : base);
}
