import { Clipboard, getSelectedFinderItems } from "@raycast/api";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { ChatImage } from "../litellm/types";

/**
 * Formats the vision models on the other side actually decode. Deliberately
 * short: LiteLLM converts these for Ollama with Pillow, and an exotic format
 * fails inside the proxy with a message about neither the file nor the command.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** 20 MB. Base64 inflates by a third, so the request is ~27 MB before headers. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function imageMimeType(path: string): string | undefined {
  return MIME_BY_EXTENSION[extname(path).toLowerCase()];
}

/** Returns a problem description, or undefined when the size is usable. */
export function validateImageSize(bytes: number, name: string): string | undefined {
  if (bytes === 0) return `${name} is empty.`;
  if (bytes > MAX_IMAGE_BYTES) {
    return `${name} is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit.`;
  }
  return undefined;
}

export function toDataUri(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

async function readImage(path: string): Promise<ChatImage> {
  const mimeType = imageMimeType(path);
  if (!mimeType) {
    throw new Error(`${path.split("/").pop()} is not a supported image (png, jpg, gif, webp).`);
  }

  const { size } = await stat(path);
  const problem = validateImageSize(size, path.split("/").pop() ?? path);
  if (problem) throw new Error(problem);

  return { dataUri: toDataUri(mimeType, await readFile(path)), mimeType };
}

/**
 * Images a vision command operates on: the Finder selection if there is one,
 * otherwise a file on the clipboard.
 *
 * Unlike text input this has no preference to honour — Finder first is the only
 * ordering that makes sense, since a clipboard almost always holds something and
 * would otherwise win over the files the user deliberately selected.
 */
export async function getCommandImages(): Promise<ChatImage[]> {
  let selected: string[] = [];
  try {
    selected = (await getSelectedFinderItems()).map((item) => item.path);
  } catch {
    // Raycast throws when Finder is not frontmost, which is not an error here:
    // the clipboard is a legitimate second source, and a real failure surfaces
    // below as "no image found".
  }

  const paths = selected.filter((p) => imageMimeType(p));

  if (paths.length === 0) {
    const { file } = await Clipboard.read();
    if (file) {
      const path = decodeURIComponent(file.replace(/^file:\/\//, ""));
      if (imageMimeType(path)) paths.push(path);
    }
  }

  if (paths.length === 0) {
    throw new Error("No image found. Select one or more images in Finder, or copy an image file.");
  }

  return Promise.all(paths.map(readImage));
}
