import { Tool } from "./types";
import { webFetch, webSearch } from "./tools/web";
import { readBrowserTab, readClipboard, readSelection } from "./tools/raycast";
import { readFile, writeFile } from "./tools/files";
import { pasteText, runShell, writeClipboard } from "./tools/system";

export { findTool, filterTools, toolDefinitions } from "./toolset";

/** Every tool the agent can be given. */
export const ALL_TOOLS: Tool[] = [
  webSearch,
  webFetch,
  readClipboard,
  readSelection,
  readBrowserTab,
  readFile,
  writeClipboard,
  pasteText,
  writeFile,
  runShell,
];
