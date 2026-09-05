import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { requestPinned } from "../src/lib/agent/tools/web";

/**
 * Exercises the real `node:http` transport end to end: a real socket, a real
 * server, no `vi.mock` anywhere in this file, and no address validation
 * (that's `resolvePublicAddress`'s job, covered elsewhere).
 *
 * This is the only test in the suite that can catch a `lookup` callback
 * shaped wrong for what Node actually calls it with. `tests/web-fetch.test.ts`
 * mocks `node:http`/`node:https` wholesale and drives the `lookup` option
 * itself, so it validates that callback against its own assumptions about the
 * calling convention — it cannot notice if those assumptions are wrong. They
 * were: Node's happy-eyeballs path (`autoSelectFamily`, on by default here)
 * calls a custom `lookup` with `{ all: true }` and expects the array callback
 * form; a callback that only implements the legacy 3-arg form fails every
 * real request with ERR_INVALID_IP_ADDRESS while still passing every mocked
 * test, since the mock never exercises the `{ all: true }` shape Node uses.
 */
describe("requestPinned — real transport", () => {
  let server: Server;
  let port: number;

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<void> {
    server = createServer(handler);
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("Expected an AddressInfo.");
        port = address.port;
        resolve();
      });
    });
  }

  // A generous deadline for the tests that are expected to actually finish —
  // real requestPinned callers compute this once from the module's own
  // 60s default; these tests inject their own so a slow CI box can't flake
  // them, without needing to wait anywhere near 60s either way.
  const ampleDeadline = () => Date.now() + 5_000;

  it("connects and reads a real response through the pinned lookup", async () => {
    await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello from a real server");
    });

    // The hostname in the URL ("localhost") is never the one actually
    // resolved: the pinned address below is. That mismatch is the point —
    // it's what proves the connection went where the pin says, not to
    // whatever "localhost" would otherwise resolve to.
    const response = await requestPinned(
      new URL(`http://localhost:${port}/`),
      { address: "127.0.0.1", family: 4 },
      ampleDeadline(),
    );

    expect(response.status).toBe(200);
    expect(response.body).toBe("hello from a real server");
  });

  it("decodes a gzip-compressed response into readable text", async () => {
    await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
      res.end(gzipSync(Buffer.from("compressed hello")));
    });

    const response = await requestPinned(
      new URL(`http://localhost:${port}/`),
      { address: "127.0.0.1", family: 4 },
      ampleDeadline(),
    );

    expect(response.body).toBe("compressed hello");
  });

  // The decompression-bomb case: a few KB on the wire, gigabytes if fully
  // expanded. This has to fail fast and cheaply — zlib's maxOutputLength
  // aborts *during* decompression, so a correct fix never allocates anywhere
  // near the full expansion. If this test hangs or the process's memory
  // balloons instead of rejecting quickly, the cap isn't wired up.
  it("throws instead of allocating when a small compressed body decompresses past the cap", async () => {
    const bomb = gzipSync(Buffer.alloc(20_000_000, "a")); // ~20MB of "a" compresses to a few KB
    await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
      res.end(bomb);
    });

    await expect(
      requestPinned(new URL(`http://localhost:${port}/`), { address: "127.0.0.1", family: 4 }, ampleDeadline()),
    ).rejects.toThrow(/Decompressing the response \(gzip\) exceeded the 1000000-byte limit/);
  });

  // The finding this closes: a server that sends headers and then never
  // finishes the body crosses none of the byte caps and would otherwise hang
  // forever. A short, injected deadline keeps this test fast rather than
  // waiting anywhere near the real 60s default.
  it("times out and destroys the connection when a server never finishes responding", async () => {
    await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("partial, and then nothing else, ever");
      // Deliberately never call res.end() — this handler is the "drips a
      // byte every thirty seconds" server, just without the thirty seconds.
    });

    const shortDeadline = Date.now() + 200;
    await expect(
      requestPinned(new URL(`http://localhost:${port}/`), { address: "127.0.0.1", family: 4 }, shortDeadline),
    ).rejects.toThrow(/exceeded the \d+ms request timeout/);
  });
});
