export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Reduce an HTML document to readable text.
 *
 * Script and style bodies are removed before tags are stripped: to a stripper
 * that only deletes angle-bracket runs they are ordinary text, and the model
 * would be handed minified JavaScript as if it were the page.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")
      .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Pull results out of a lite.duckduckgo.com page.
 *
 * Every href is a duckduckgo.com/l/ redirect with the real destination in an
 * encoded `uddg` parameter; handing those redirects to a model as the answer
 * would be useless, so they are unwrapped here.
 */
export function parseSearchResults(html: string): SearchResult[] {
  const links = [
    ...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi),
  ];
  const snippets = [...html.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\//gi)].map((m) => htmlToText(m[1]));

  return links.map((m, i) => {
    const href = decodeEntities(m[1]);
    const uddg = /[?&]uddg=([^&]+)/.exec(href)?.[1];
    return {
      title: htmlToText(m[2]),
      url: uddg ? decodeURIComponent(uddg) : href,
      snippet: snippets[i] ?? "",
    };
  });
}
