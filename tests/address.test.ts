import { describe, expect, it, vi, type Mock } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import { isBlockedAddress, resolvePublicAddress } from "../src/lib/agent/address";

// `dns/promises`' `lookup` is overloaded (single address vs. `{ all: true }`
// returning an array), and vi.mocked() pins to one overload. The mock only
// ever needs to stand in for the `{ all: true }` array form here, so it's
// treated as an untyped double rather than fought into one overload's shape.
const mockedLookup = lookup as unknown as Mock;

describe("isBlockedAddress", () => {
  it("blocks loopback", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("127.1.2.3")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
  });

  it("blocks private ranges", () => {
    expect(isBlockedAddress("10.0.0.5")).toBe(true);
    expect(isBlockedAddress("172.16.0.1")).toBe(true);
    expect(isBlockedAddress("172.31.255.255")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
    expect(isBlockedAddress("fc00::1")).toBe(true);
    expect(isBlockedAddress("fd12:3456::1")).toBe(true);
  });

  it("blocks link-local, including the cloud metadata address", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
  });

  it("blocks the unspecified address", () => {
    expect(isBlockedAddress("0.0.0.0")).toBe(true);
    expect(isBlockedAddress("::")).toBe(true);
  });

  // 172.16/12 is the private range — 172.15 and 172.32 are public, and an
  // octet-prefix check would wrongly block them.
  it("does not block public addresses that look adjacent to private ranges", () => {
    expect(isBlockedAddress("172.15.0.1")).toBe(false);
    expect(isBlockedAddress("172.32.0.1")).toBe(false);
    expect(isBlockedAddress("11.0.0.1")).toBe(false);
    expect(isBlockedAddress("193.168.1.1")).toBe(false);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2606:4700::1111")).toBe(false);
  });

  // An IPv4 address wrapped in IPv6 reaches the same host.
  it("blocks IPv4-mapped IPv6 forms of blocked addresses", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:192.168.0.1")).toBe(true);
  });

  // RFC 4291 allows the same IPv4-mapped address to be written as two hex
  // groups instead of a dotted quad: 0x7f00:0x0001 is 127.0.0.1, the same
  // host as ::ffff:127.0.0.1 above. A check that only strips the dotted form
  // lets this one straight through.
  it("blocks the pure-hex form of an IPv4-mapped address", () => {
    expect(isBlockedAddress("::ffff:7f00:1")).toBe(true); // 127.0.0.1
    expect(isBlockedAddress("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
  });

  it("does not block the pure-hex form of a public IPv4-mapped address", () => {
    expect(isBlockedAddress("::ffff:0808:0808")).toBe(false); // 8.8.8.8
  });
});

describe("resolvePublicAddress", () => {
  it("returns the resolved address so the caller can pin the connection to it", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
    await expect(resolvePublicAddress(new URL("https://example.test/"))).resolves.toEqual({
      address: "8.8.8.8",
      family: 4,
    });
  });

  // A hostname can resolve to more than one address (round-robin DNS); the
  // check exists to block a fetch, so any one bad answer must be enough.
  it("rejects if any answer is blocked, not just the first", async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(resolvePublicAddress(new URL("https://example.test/"))).rejects.toThrow(/not a public address/);
  });

  // The gap this closes: dns.lookup can resolve to zero answers (notably for
  // an empty hostname), and a loop that finds nothing to reject would treat
  // that as "nothing blocked" and pass vacuously.
  it("rejects rather than vacuously passing when resolution returns no answers", async () => {
    mockedLookup.mockResolvedValueOnce([]);
    await expect(resolvePublicAddress(new URL("https://example.test/"))).rejects.toThrow(/did not resolve/);
  });
});
