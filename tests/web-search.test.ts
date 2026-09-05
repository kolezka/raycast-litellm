import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// I3: web_search used to call the global fetch() directly — no timeout, no
// response size cap, no bound of any kind — while web_fetch went through the
// hardened pinned transport. These mocks are what makes the difference
// observable: if web_search still used bare fetch(), it would never touch
// node:https.request at all, and every assertion below would fail because
// the mock was never invoked.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:http", () => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { webSearch } from "../src/lib/agent/tools/web";

const mockedLookup = lookup as unknown as Mock;
const mockedHttpsRequest = httpsRequest as unknown as Mock;

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
});

describe("webSearch.run — routed through the bounded pinned transport", () => {
  const resultsHtml = `
    <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.test%2F&amp;rut=1" class='result-link'>Example</a>
    <td class='result-snippet'>A snippet.</td>`;

  it("goes through node:https.request rather than a bare fetch()", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "203.0.113.9", family: 4 }]);
    respondWith(200, { "content-type": "text/html" }, resultsHtml);

    const result = await webSearch.run({ query: "raycast" });

    expect(mockedLookup).toHaveBeenCalledWith("lite.duckduckgo.com", { all: true });
    expect(mockedHttpsRequest).toHaveBeenCalledTimes(1);
    const options = mockedHttpsRequest.mock.calls[0][0] as { hostname: string };
    expect(options.hostname).toBe("lite.duckduckgo.com");
    expect(result).toContain("https://example.test/");
  });

  // The bound that was missing: previously nothing stopped an unbounded
  // response from being buffered in full before parseSearchResults ever ran.
  it("enforces the same response size cap web_fetch gets", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "203.0.113.9", family: 4 }]);
    respondWith(200, { "content-type": "text/html" }, Buffer.alloc(10_000_001));

    await expect(webSearch.run({ query: "raycast" })).rejects.toThrow(/exceeded the 10000000-byte response limit/);
  });

  it("rejects a blocked address before connecting, same as web_fetch", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(webSearch.run({ query: "raycast" })).rejects.toThrow(/not a public address/);
    expect(mockedHttpsRequest).not.toHaveBeenCalled();
  });
});
