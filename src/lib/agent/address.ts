import { lookup } from "node:dns/promises";

/**
 * Unwraps an IPv4-mapped IPv6 address to its dotted-quad form.
 *
 * RFC 4291 allows the same address to be written two ways: dotted-quad
 * (`::ffff:127.0.0.1`) or two hex groups (`::ffff:7f00:1`). Both reach the
 * same host, so both must classify identically — a check that only strips
 * the dotted form lets the hex form straight through.
 */
function unwrapIPv4Mapped(ip: string): string {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (dotted) return dotted[1];

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
  }

  return ip;
}

/**
 * Addresses a model-chosen URL must never reach.
 *
 * The agent fetches URLs that can originate in content it just read, so a fetch
 * is an instruction from a third party. Everything here is reachable from this
 * machine but not from the internet: the loopback interface, the LAN, and the
 * link-local range that carries cloud metadata services.
 */
export function isBlockedAddress(address: string): boolean {
  const ip = unwrapIPv4Mapped(address.toLowerCase());

  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  if (ip === "::" || ip === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true;
  return false;
}

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Resolves a hostname, rejects if any answer is blocked, and returns the one
 * address the caller must connect to.
 *
 * Resolving here and letting the caller resolve again to connect is the gap
 * this whole check exists to close: nothing ties the two lookups together, so
 * an attacker who controls the domain can answer the first query with a
 * public address and the second — moments later, a low TTL is cheap to set —
 * with a private one (DNS rebinding). Returning the resolved address lets the
 * caller pin the connection to exactly what was checked, so there is no
 * second lookup left to attack.
 *
 * An empty hostname is rejected explicitly: `dns.lookup("", { all: true })`
 * resolves to `[]` rather than throwing, and a loop that only rejects blocked
 * answers would find nothing to reject and pass vacuously.
 */
export async function resolvePublicAddress(url: URL): Promise<PinnedAddress> {
  if (!url.hostname) throw new Error(`${url.href} has no hostname to resolve.`);

  const answers = await lookup(url.hostname, { all: true });
  if (answers.length === 0) throw new Error(`${url.hostname} did not resolve to any address.`);

  for (const { address } of answers) {
    if (isBlockedAddress(address)) {
      throw new Error(`${url.hostname} resolves to ${address}, which is not a public address.`);
    }
  }

  const [{ address, family }] = answers;
  return { address, family: family === 6 ? 6 : 4 };
}
