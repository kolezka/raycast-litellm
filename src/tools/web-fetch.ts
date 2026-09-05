import { htmlToText } from "../lib/web/parse";

type Input = {
  /** Absolute http(s) URL of the page to read. */
  url: string;
};

/** Pages longer than this are truncated: the caller is a context window, not a disk. */
const MAX_CHARS = 100_000;

export default async function webFetch(input: Input): Promise<string> {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error(`Not a valid URL: ${input.url}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol ${url.protocol} — only http and https can be fetched.`);
  }

  const response = await fetch(url, {
    headers: { "User-Agent": "Raycast-LiteLLM/1.0", Accept: "text/html,text/plain;q=0.9,*/*;q=0.8" },
    redirect: "follow",
  });

  // A non-200 must throw rather than return "": an empty string reads to the
  // model as "this page says nothing", which is a different claim from "this
  // page could not be read", and it will answer confidently either way.
  if (!response.ok) {
    throw new Error(`${url.href} returned HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const text = contentType.includes("html") ? htmlToText(body) : body.trim();

  if (!text) throw new Error(`${url.href} returned no readable text (content-type: ${contentType || "unknown"}).`);

  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[truncated at ${MAX_CHARS} characters]` : text;
}
