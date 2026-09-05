import { getPreferenceValues, LocalStorage } from "@raycast/api";
import type { ExtensionPreferences } from "./litellm/types";
import { CommandName } from "./enums";

const key = (command: CommandName) => `model:${command}`;

export async function getCommandModel(command: CommandName): Promise<string | undefined> {
  return LocalStorage.getItem<string>(key(command));
}

export async function setCommandModel(command: CommandName, model: string): Promise<void> {
  await LocalStorage.setItem(key(command), model);
}

/**
 * The model a command should use: its own override, else the default-model
 * preference. Returns "" when neither is set; the caller then falls back to the
 * first model the proxy lists and surfaces that choice in the view title, so the
 * user always knows which model answered.
 */
export async function resolveModel(command: CommandName): Promise<string> {
  const override = await getCommandModel(command);
  if (override) return override;
  return getPreferenceValues<ExtensionPreferences>().defaultModel ?? "";
}
