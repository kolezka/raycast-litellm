import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// webFetch must never touch a real socket or a real DNS server in tests: both
// the resolver and the transport are mocked, so a dropped address check or a
// reversion to automatic redirects would surface as a wrong call count here
// rather than as a silent pass.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:http", () => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { requestPinned, webFetch } from "../src/lib/agent/tools/web";

// Real Node http/dns types are overloaded and don't line up with the small
// fake shapes these tests hand back (see address.test.ts for the same call).
const mockedLookup = lookup as unknown as Mock;
const mockedHttpsRequest = httpsRequest as unknown as Mock;
const mockedHttpRequest = httpRequest as unknown as Mock;

/** A fake `IncomingMessage`: an EventEmitter that delivers its body once told to, and can be `.destroy()`ed like a real one. */
class FakeIncomingMessage extends EventEmitter {
  destroy = vi.fn();
  private body: Buffer;
  constructor(
    public statusCode: number,
    public headers: Record<string, string>,
    body: string | Buffer = "",
  ) {
    super();
    this.body = Buffer.isBuffer(body) ? body : Buffer.from(body);
  }
  deliver() {
    if (this.body.length > 0) this.emit("data", this.body);
    this.emit("end");
  }
}

/**
 * Queues one response from the mocked `https.request`, and returns the fake
 * `ClientRequest` so a test can assert on how it was built (in particular,
 * the pinned `lookup` option passed in `options`).
 *
 * The body is delivered on a later microtask, but only *after* invoking the
 * production callback synchronously — that callback is what attaches the
 * `data`/`end` listeners. Emitting first and attaching listeners after would
 * lose the event: a plain EventEmitter, unlike a real stream, does not buffer
 * for a listener that hasn't subscribed yet.
 */
function respondWith(status: number, headers: Record<string, string>, body: string | Buffer = "") {
  const response = new FakeIncomingMessage(status, headers, body);
  const clientRequest = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  mockedHttpsRequest.mockImplementationOnce((_options: unknown, callback?: (res: unknown) => void) => {
    callback?.(response);
    queueMicrotask(() => response.deliver());
    return clientRequest;
  });
  return { clientRequest, response };
}

beforeEach(() => {
  mockedLookup.mockReset();
  mockedHttpsRequest.mockReset();
  mockedHttpRequest.mockReset();
});

describe("webFetch.run — redirect handling and address pinning", () => {
  it("refuses a blocked initial host before making any connection", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);

    await expect(webFetch.run({ url: "https://attacker.test/" })).rejects.toThrow(/not a public address/);
    expect(mockedHttpsRequest).not.toHaveBeenCalled();
  });

  // The check that cleared the first host says nothing about where a
  // redirect from that host leads — DNS rebinding and open redirects both
  // rely on exactly this hop being unchecked.
  it("validates every hop, not just the first", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "93.184.216.1", family: 4 }]); // first host: public
    mockedLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]); // redirect target: blocked
    respondWith(302, { location: "https://internal.test/secret" });

    await expect(webFetch.run({ url: "https://public.test/" })).rejects.toThrow(/not a public address/);
    // The second hop was rejected before a connection to it was attempted.
    expect(mockedHttpsRequest).toHaveBeenCalledTimes(1);
  });

  it("throws once the hop cap is exceeded, rather than following redirects forever", async () => {
    mockedLookup.mockResolvedValue([{ address: "93.184.216.1", family: 4 }]);
    for (let i = 0; i < 7; i++) {
      respondWith(302, { location: `https://public.test/${i}` });
    }

    await expect(webFetch.run({ url: "https://public.test/0" })).rejects.toThrow(/redirected more than 5 times/);
    expect(mockedHttpsRequest).toHaveBeenCalledTimes(6); // hops 0..5 inclusive
  });

  it("resolves a relative Location against the current URL and returns the final page", async () => {
    mockedLookup.mockResolvedValue([{ address: "93.184.216.1", family: 4 }]);
    respondWith(302, { location: "/next" });
    respondWith(200, { "content-type": "text/plain" }, "hello");

    const result = await webFetch.run({ url: "https://public.test/start" });

    expect(result).toBe("hello");
    const secondCallOptions = mockedHttpsRequest.mock.calls[1][0] as { hostname: string; path: string };
    expect(secondCallOptions.hostname).toBe("public.test");
    expect(secondCallOptions.path).toBe("/next");
  });

  // The whole point of the fix: the connection must go to the address that
  // was validated, not to whatever a second, uncorrelated DNS lookup returns.
  //
  // Node's custom `lookup` option has two calling conventions: the legacy
  // 3-arg form `(err, address, family)`, and the array form `(err,
  // addresses)` that its happy-eyeballs path (`autoSelectFamily`, on by
  // default) uses when it calls `lookup` with `{ all: true }`. A previous
  // version of this code only implemented the 3-arg form; it passed this
  // exact assertion (mocked, driven with `{}`) while failing every real
  // request with ERR_INVALID_IP_ADDRESS, because the mock never exercised
  // `{ all: true }`. Both forms are asserted here so that gap can't recur
  // silently; tests/web-fetch-transport.test.ts additionally proves it
  // against Node's real transport, not just this mock.
  it("pins the connection to the exact address that was validated, under both lookup calling conventions", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "203.0.113.9", family: 4 }]);
    respondWith(200, { "content-type": "text/plain" }, "hi");

    await webFetch.run({ url: "https://public.test/" });

    const options = mockedHttpsRequest.mock.calls[0][0] as {
      family: number;
      lookup: (
        hostname: string,
        opts: { all?: boolean },
        cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void,
      ) => void;
    };
    expect(options.family).toBe(4);

    const legacyForm = await new Promise((resolve) => {
      options.lookup("public.test", {}, (_err, address) => resolve(address));
    });
    expect(legacyForm).toBe("203.0.113.9");

    const arrayForm = await new Promise((resolve) => {
      options.lookup("public.test", { all: true }, (_err, address) => resolve(address));
    });
    expect(arrayForm).toEqual([{ address: "203.0.113.9", family: 4 }]);
  });

  // fetch() decoded a compressed body for free; the hand-rolled transport
  // has to ask not to receive one and decode it if a server sends one
  // anyway — silently returning compressed bytes as "page text" is worse
  // than an outright failure.
  it("asks for an uncompressed response", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "203.0.113.9", family: 4 }]);
    respondWith(200, { "content-type": "text/plain" }, "hi");

    await webFetch.run({ url: "https://public.test/" });

    const options = mockedHttpsRequest.mock.calls[0][0] as { headers: Record<string, string> };
    expect(options.headers["Accept-Encoding"]).toBe("identity");
  });

  it("throws naming the encoding when a server sends one this can't decode", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "203.0.113.9", family: 4 }]);
    respondWith(200, { "content-type": "text/plain", "content-encoding": "compress" }, "garbage");

    await expect(webFetch.run({ url: "https://public.test/" })).rejects.toThrow(
      /Unsupported Content-Encoding: compress/,
    );
  });

  // Chained encodings are undone in reverse: the header lists the order they
  // were *applied* (RFC 9110 §8.4), so the last one listed is the outermost
  // and has to come off first. Decoding left-to-right would try to gunzip
  // the still-brotli-wrapped bytes and fail (or, worse, produce garbage);
  // this payload was built the same way a real server would build it —
  // gzip first, then brotli over the result.
  it("decodes chained Content-Encoding values in reverse order", async () => {
    const zlib = await import("node:zlib");
    const original = Buffer.from("hello, chained encodings");
    const doubleEncoded = zlib.brotliCompressSync(zlib.gzipSync(original));

    mockedLookup.mockResolvedValueOnce([{ address: "203.0.113.9", family: 4 }]);
    respondWith(200, { "content-type": "text/plain", "content-encoding": "gzip, br" }, doubleEncoded);

    const result = await webFetch.run({ url: "https://public.test/" });
    expect(result).toBe("hello, chained encodings");
  });

  // The raw byte cap protects against more than compression bombs — it's a
  // ceiling on the socket regardless of encoding. A single chunk crossing it
  // must stop the response outright rather than buffer and truncate later.
  it("rejects and stops consuming once the raw response exceeds the byte cap", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "203.0.113.9", family: 4 }]);
    const { clientRequest, response } = respondWith(200, { "content-type": "text/plain" }, Buffer.alloc(10_000_001));

    await expect(webFetch.run({ url: "https://public.test/" })).rejects.toThrow(
      /exceeded the 10000000-byte response limit/,
    );
    expect(response.destroy).toHaveBeenCalled();
    expect(clientRequest.destroy).toHaveBeenCalled();
  });

  // requestPinned takes an absolute deadline, not a duration, specifically so
  // webFetch.run can compute it once and hand the *same* value to every
  // redirect hop — this is what makes the timeout a shared budget for the
  // whole chain instead of a fresh allowance each hop. This proves the
  // "shared" half directly: an already-expired deadline (the state a later
  // hop would be in once earlier hops had spent the whole budget) must fire
  // right away, not restart a fresh timer of its own.
  it("honors an externally-computed deadline immediately, rather than starting a fresh timeout per call", async () => {
    const response = new FakeIncomingMessage(200, { "content-type": "text/plain" });
    const clientRequest = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
    mockedHttpsRequest.mockImplementationOnce((_options: unknown, callback?: (res: unknown) => void) => {
      callback?.(response);
      // Deliberately never delivered: nothing except the deadline can end
      // this call.
      return clientRequest;
    });

    const alreadyExpired = Date.now() - 1_000;
    await expect(
      requestPinned(new URL("https://public.test/"), { address: "203.0.113.9", family: 4 }, alreadyExpired),
    ).rejects.toThrow(/exceeded the 0ms request timeout/);
    expect(clientRequest.destroy).toHaveBeenCalled();
  });

  // Regression for the exact gap the reviewer found: only the initial URL's
  // scheme was checked, so a redirect to a scheme with no hostname (dns
  // resolution of "" returns no answers, not an error) would otherwise pass
  // the address check vacuously instead of being refused outright.
  it("re-checks the protocol on every hop, not just the first", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "93.184.216.1", family: 4 }]);
    respondWith(302, { location: "file:///etc/passwd" });

    await expect(webFetch.run({ url: "https://public.test/" })).rejects.toThrow(/Unsupported protocol/);
    // Never attempted to resolve the second hop at all — the protocol check
    // rejects it first.
    expect(mockedLookup).toHaveBeenCalledTimes(1);
  });
});
