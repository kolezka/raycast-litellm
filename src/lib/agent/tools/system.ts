import { Clipboard } from "@raycast/api";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Tool } from "../types";

const run = promisify(exec);

export const writeClipboard: Tool = {
  risk: "write",
  taints: false,
  definition: {
    name: "write_clipboard",
    description: "Put text on the clipboard.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  async run(input) {
    await Clipboard.copy(String(input.text));
    return "Copied to the clipboard.";
  },
};

export const pasteText: Tool = {
  risk: "write",
  taints: false,
  definition: {
    name: "paste_text",
    description: "Paste text into the frontmost application.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  async run(input) {
    await Clipboard.paste(String(input.text));
    return "Pasted into the frontmost app.";
  },
};

export const runShell: Tool = {
  risk: "execute",
  // A command's stdout is no more authored by us than a file's contents or a
  // web page's — and leaving this false was an exfiltration hole: one
  // approved shell call that echoes planted text would never taint the
  // session, so a later web_fetch (read_remote, auto-allowed while untainted)
  // could send that text anywhere with no confirmation at all.
  taints: true,
  definition: {
    name: "run_shell",
    description: "Run a shell command and return its output. Only allowlisted commands are permitted.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "The complete command line" } },
      required: ["command"],
    },
  },
  async run(input) {
    // A command that fails must throw, not return "": empty output reads to the
    // model as "this produced nothing", which is a different claim.
    try {
      const { stdout, stderr } = await run(String(input.command), { timeout: 30_000, maxBuffer: 1_000_000 });
      return stdout.trim() || stderr.trim() || "(no output)";
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(e.stderr?.trim() || e.message || "Command failed.");
    }
  },
};
