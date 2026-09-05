import { parseSearchResults } from "../lib/web/parse";

type Input = {
  /** What to search for. */
  query: string;
};

/**
 * Search the web.
 *
 * Backed by DuckDuckGo's keyless lite endpoint, which means there is no API key
 * to configure and also no stability guarantee: it returns HTML meant for a
 * browser, so a markup change breaks parsing. That failure surfaces as "no
 * results", which is why an empty parse of a 200 response is reported as a
 * parsing failure rather than silently as an empty result set.
 */
export default async function webSearch(input: Input): Promise<string> {
  const query = input.query.trim();
  if (!query) throw new Error("Search query is empty.");

  const response = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
  });

  if (!response.ok) {
    throw new Error(`Search returned HTTP ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const results = parseSearchResults(html);

  if (results.length === 0) {
    if (/no results|not match any documents/i.test(html)) return `No results for "${query}".`;
    throw new Error(`Could not parse the search response for "${query}" — the result markup has likely changed.`);
  }

  return results
    .slice(0, 10)
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`)
    .join("\n\n");
}
