import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupAddress, LookupOptions } from "node:dns";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { PinnedAddress, resolvePublicAddress } from "../address";
import { htmlToText, parseSearchResults } from "../../web/parse";
import { Tool } from "../types";

const MAX_CHARS = 100_000;
const MAX_REDIRECTS = 5;

export interface PinnedResponse {
  status: number;
  contentType: string;
  location: string | null;
  body: string;
}

/**
 * Hard ceiling on bytes read off the socket, whatever the encoding.
 *
 * This is the first line of defense against a compression bomb: it bounds
 * how much input the process will ever buffer before attempting to decode
 * it, regardless of the eventual expansion ratio. 10 MB is comfortably above
 * any real text page — even a large, markup-heavy one — while nowhere near
 * memory-exhausting for a single-process extension.
 */
const MAX_RESPONSE_BYTES = 10_000_000;

/**
 * Hard ceiling on decompressed bytes, passed to every zlib call as
 * `maxOutputLength`.
 *
 * Sized against the 100_000-character return limit below, not left at
 * zlib's default (effectively unbounded — large enough that a few kilobytes
 * of gzip can expand past a gigabyte on this process's single thread). 10x
 * gives a real page headroom for the markup and whitespace `htmlToText`
 * strips back out; it's nowhere close to what a bomb needs to do damage,
 * since zlib checks this incrementally during decompression and aborts as
 * soon as it's crossed, before allocating anywhere near the full expansion.
 */
const MAX_DECODED_BYTES = MAX_CHARS * 10;

/**
 * Overall deadline for a fetch, covering every redirect hop as one shared
 * budget rather than resetting per hop — a server that answers just slowly
 * enough on each of several redirects would otherwise multiply the wait to
 * several times this limit instead of being bounded by it.
 *
 * There is a `requestTimeout` extension preference (`src/lib/litellm/config.ts`),
 * but reading it means importing `getPreferenceValues` from `@raycast/api`,
 * and in this workspace that package ships types only — confirmed empirically
 * (`require("@raycast/api")` fails to resolve outside the Raycast host, and
 * every existing test that touches a module importing it mocks it first, e.g.
 * `registry.test.ts`). There's also no established path yet for threading a
 * preference value into `Tool.run()`. 60s mirrors that same preference's own
 * default in `getConfig()`, rather than being a new, arbitrary number.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Decodes a response body per `Content-Encoding`.
 *
 * The hand-rolled transport below gets no automatic decompression the way
 * `fetch` gave it for free, and plenty of servers compress a response even
 * when asked not to. Decoding explicitly — and refusing an encoding this
 * doesn't recognise, or one whose decompressed size crosses
 * MAX_DECODED_BYTES — is the alternative to silently handing the model
 * compressed bytes, or freezing the event loop, labelled as page text.
 */
function decodeBody(raw: Buffer, contentEncoding: string): Buffer {
  let data = raw;
  // RFC 9110 §8.4: codings are listed in the order they were *applied*, so
  // undoing them means working backwards — the last-listed coding is the
  // outermost and has to come off first ("gzip, br" means gzip then br were
  // applied in that order, so br must be removed before gzip).
  const encodings = contentEncoding
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .reverse();

  for (const encoding of encodings) {
    try {
      switch (encoding) {
        case "identity":
          break;
        case "gzip":
        case "x-gzip":
          data = gunzipSync(data, { maxOutputLength: MAX_DECODED_BYTES });
          break;
        case "deflate":
          data = inflateSync(data, { maxOutputLength: MAX_DECODED_BYTES });
          break;
        case "br":
          data = brotliDecompressSync(data, { maxOutputLength: MAX_DECODED_BYTES });
          break;
        default:
          throw new Error(`Unsupported Content-Encoding: ${encoding}`);
      }
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
        throw new Error(`Decompressing the response (${encoding}) exceeded the ${MAX_DECODED_BYTES}-byte limit.`);
      }
      throw err;
    }
  }
  return data;
}

/**
 * Performs one HTTP(S) request pinned to `pinned.address`.
 *
 * `http.request`/`https.request` accept a `lookup` option in place of
 * `dns.lookup`; handing it a function that always returns the address
 * `resolvePublicAddress` already validated means the socket can only ever
 * reach that address, so a second, uncorrelated DNS answer (rebinding) never
 * gets consulted. The URL keeps its real hostname for the request options,
 * so the Host header and TLS SNI (derived from the same hostname) stay
 * correct — only the wire-level connection target is pinned.
 *
 * `family` is also set explicitly: Node's happy-eyeballs path
 * (`autoSelectFamily`, on by default) calls a custom `lookup` with
 * `{ all: true }` and expects the array callback form `(err, addresses)`;
 * without an explicit family it took that path and our lookup replied with
 * the legacy 3-arg form, so nothing ever connected (ERR_INVALID_IP_ADDRESS)
 * despite every test that mocked `lookup` directly passing. Setting `family`
 * avoids that path today, but the callback below also honours `options.all`
 * itself, so this is correct under either invocation Node chooses rather
 * than depending on which one it picks today.
 *
 * `deadline` is an absolute time (`Date.now()`-style ms), not a duration:
 * the caller computes it once, before the first hop, and passes the same
 * value to every hop's call so the budget is shared across the whole
 * redirect chain rather than restarting each time. Without it, a server that
 * sends headers and then drips a byte every thirty seconds would cross none
 * of the byte caps above and never finish, hanging the tool call (and the
 * agent loop waiting on it) indefinitely.
 */
export function requestPinned(
  url: URL,
  pinned: PinnedAddress,
  deadline: number,
  extraHeaders?: Record<string, string>,
): Promise<PinnedResponse> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  // The remaining budget at the moment this hop started, not the module
  // constant: named in the timeout error below so it reflects what this
  // call was actually given (less than the full budget on a later hop; a
  // short, test-injected deadline in tests), not a number that may not match
  // what was actually configured for this call.
  const budgetMs = Math.max(0, deadline - Date.now());
  return new Promise((resolve, reject) => {
    // Guards every termination path — the byte cap, the deadline, a normal
    // finish, a transport error — behind a single settle-once gate.
    // `destroy()`ing a request/response can still fire further events
    // afterwards (an `error` following a `data`-triggered `destroy()`, for
    // instance), and without this a later event could try to resolve/reject
    // an already-settled promise, which is harmless for the Promise itself
    // but would mean the "real" reason for stopping gets silently replaced.
    let settled = false;
    // `timer` is declared with `const` further down, after `req` exists.
    // `settle`'s closure only reads it once an async event fires — always
    // after that declaration has run — so this forward reference is not a
    // TDZ hazard, just an ordering `settle` needs to exist before `request()`
    // is called (its callbacks close over it).
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const req = request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        family: pinned.family,
        // `extraHeaders` can override the default User-Agent (webSearch does,
        // to look like a browser to a search endpoint that may otherwise
        // reject it) but never Accept-Encoding: identity — that one is load
        // bearing for decodeBody below and must never lose to a caller.
        headers: { "User-Agent": "Raycast-LiteLLM/1.0", ...extraHeaders, "Accept-Encoding": "identity" },
        lookup: (
          _hostname: string,
          options: LookupOptions,
          callback: (err: null, address: string | LookupAddress[], family?: number) => void,
        ) => {
          if (options.all) {
            callback(null, [{ address: pinned.address, family: pinned.family }]);
          } else {
            callback(null, pinned.address, pinned.family);
          }
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;

        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            // Stop consuming rather than silently truncating: a truncated
            // body would still get decoded (or attempted) as if it were
            // complete, which is its own way of handing back garbage.
            settle(() => {
              response.destroy();
              req.destroy();
              reject(new Error(`${url.href} exceeded the ${MAX_RESPONSE_BYTES}-byte response limit.`));
            });
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          settle(() => {
            try {
              const contentEncoding = (response.headers["content-encoding"] as string | undefined) ?? "";
              const raw = Buffer.concat(chunks);
              const body = (contentEncoding ? decodeBody(raw, contentEncoding) : raw).toString("utf8");
              resolve({
                status: response.statusCode ?? 0,
                contentType: (response.headers["content-type"] as string | undefined) ?? "",
                location: (response.headers.location as string | undefined) ?? null,
                body,
              });
            } catch (err) {
              reject(err);
            }
          });
        });
        response.on("error", (err) => settle(() => reject(err)));
      },
    );

    // Started as soon as the request exists, not from the first response
    // byte: a server that never sends headers at all is the same hang as one
    // that drips the body, and both have to be caught by the same deadline.
    const timer = setTimeout(() => {
      settle(() => {
        req.destroy();
        reject(new Error(`${url.href} exceeded the ${budgetMs}ms request timeout.`));
      });
    }, budgetMs);

    req.on("error", (err) => settle(() => reject(err)));
    req.end();
  });
}

/**
 * Fetches `url` through the pinned transport, following redirects up to
 * `MAX_REDIRECTS` on one shared deadline, and returns the final 2xx response
 * together with the URL it was actually served from (which can differ from
 * `url` after a redirect).
 *
 * Shared by `webFetch` and `webSearch`. `webSearch`'s target is a constant —
 * pinning its address buys it nothing a hardcoded host wouldn't already
 * have — but it was going through a bare `fetch()` with none of this: no
 * deadline, no response byte cap, no decompression bound. Routing it through
 * the same function that already carries those bounds for `webFetch` is
 * what closes that gap, not the pinning that comes along with it.
 */
async function fetchBounded(
  url: URL,
  extraHeaders?: Record<string, string>,
): Promise<{ response: PinnedResponse; finalUrl: URL }> {
  // Computed once, before the first hop: passing this same absolute time to
  // every hop's requestPinned call is what makes it one shared budget for
  // the whole redirect chain rather than a fresh allowance each hop.
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;

  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Checked on every hop, not just the first: a redirect can change
    // scheme as freely as it can change host, and the address check below
    // only means anything for http(s).
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new Error(`Unsupported protocol ${current.protocol}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`${url.href} exceeded the ${REQUEST_TIMEOUT_MS}ms request timeout.`);
    }

    const pinned = await resolvePublicAddress(current);
    const response = await requestPinned(current, pinned, deadline, extraHeaders);

    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new Error(`${current.href} redirected without a location.`);
      // Re-validated on the next pass: a public URL is free to redirect to a
      // private one, and the check that cleared the first host says nothing
      // about the second.
      current = new URL(response.location, current);
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${current.href} returned HTTP ${response.status}`);
    }
    return { response, finalUrl: current };
  }
  throw new Error(`${url.href} redirected more than ${MAX_REDIRECTS} times.`);
}

export const webFetch: Tool = {
  risk: "read_remote",
  taints: true,
  definition: {
    name: "web_fetch",
    description: "Fetch a web page and return its readable text. Use for a URL you already know.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http(s) URL" } },
      required: ["url"],
    },
  },
  async run(input) {
    const { response, finalUrl } = await fetchBounded(new URL(String(input.url)));
    const text = response.contentType.includes("html") ? htmlToText(response.body) : response.body.trim();
    if (!text) throw new Error(`${finalUrl.href} returned no readable text`);
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[truncated]` : text;
  },
};

export const webSearch: Tool = {
  risk: "read_remote",
  taints: true,
  definition: {
    name: "web_search",
    description: "Search the web and return the top results with titles, URLs and snippets.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to search for" } },
      required: ["query"],
    },
  },
  async run(input) {
    const query = String(input.query).trim();
    if (!query) throw new Error("Search query is empty.");
    // Previously a bare fetch() with no timeout and no response size cap —
    // the same bounded, pinned transport webFetch uses, not because this
    // constant URL needs address pinning, but because it needs the deadline
    // and the byte caps that come bundled with it.
    const { response } = await fetchBounded(
      new URL(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`),
      {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    );
    const html = response.body;
    const results = parseSearchResults(html);
    if (results.length === 0) {
      if (/no results/i.test(html)) return `No results for "${query}".`;
      throw new Error(`Could not parse the search response for "${query}".`);
    }
    return results
      .slice(0, 10)
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`)
      .join("\n\n");
  },
};
