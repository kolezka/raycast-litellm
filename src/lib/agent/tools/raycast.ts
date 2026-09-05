import { BrowserExtension, Clipboard, getSelectedText } from "@raycast/api";
import { Tool } from "../types";

export const readClipboard: Tool = {
  risk: "read",
  // Clipboard content is no more authored by us than a web page is.
  taints: true,
  definition: {
    name: "read_clipboard",
    description: "Read the current text contents of the clipboard.",
    parameters: { type: "object", properties: {} },
  },
  async run() {
    const text = (await Clipboard.readText()) ?? "";
    if (!text.trim()) throw new Error("Clipboard is empty.");
    return text;
  },
};

export const readSelection: Tool = {
  risk: "read",
  taints: true,
  definition: {
    name: "read_selection",
    description: "Read the text currently selected in the frontmost application.",
    parameters: { type: "object", properties: {} },
  },
  async run() {
    const text = (await getSelectedText()) ?? "";
    if (!text.trim()) throw new Error("No text is selected.");
    return text;
  },
};

export const readBrowserTab: Tool = {
  risk: "read",
  taints: true,
  definition: {
    name: "read_browser_tab",
    description: "Read the text of the frontmost browser tab. Requires the Raycast browser extension.",
    parameters: { type: "object", properties: {} },
  },
  async run() {
    return BrowserExtension.getContent({ format: "markdown" });
  },
};
