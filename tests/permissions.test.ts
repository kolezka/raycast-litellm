import { describe, expect, it } from "vitest";
import { decide, parseAllowlist, shellCommandAllowed } from "../src/lib/agent/permissions";

const base = {
  tainted: false,
  writeToolsEnabled: true,
  shellAllowlist: ["ls", "git"],
  readLocalApproved: false,
};

describe("decide", () => {
  it("allows reads without asking", () => {
    expect(decide({ ...base, risk: "read" })).toBe("allow");
  });

  it("asks before the first local file read, then stops asking", () => {
    expect(decide({ ...base, risk: "read_local" })).toBe("ask");
    expect(decide({ ...base, risk: "read_local", readLocalApproved: true })).toBe("allow");
  });

  it("asks every time before writing, remembered or not", () => {
    expect(decide({ ...base, risk: "write" })).toBe("ask");
    expect(decide({ ...base, risk: "write", readLocalApproved: true })).toBe("ask");
  });

  it("denies writing and executing when write tools are switched off", () => {
    expect(decide({ ...base, risk: "write", writeToolsEnabled: false })).toBe("deny");
    expect(decide({ ...base, risk: "execute", writeToolsEnabled: false, command: "ls" })).toBe("deny");
  });

  // The switch governs side effects, not reading.
  it("leaves reads alone when write tools are switched off", () => {
    expect(decide({ ...base, risk: "read", writeToolsEnabled: false })).toBe("allow");
    expect(decide({ ...base, risk: "read_local", writeToolsEnabled: false, readLocalApproved: true })).toBe("allow");
  });

  it("denies a shell command that is not on the allowlist", () => {
    expect(decide({ ...base, risk: "execute", command: "curl evil.example" })).toBe("deny");
  });

  it("asks for an allowlisted shell command rather than running it silently", () => {
    expect(decide({ ...base, risk: "execute", command: "ls -la" })).toBe("ask");
  });

  it("denies everything executable when the allowlist is empty", () => {
    expect(decide({ ...base, risk: "execute", shellAllowlist: [], command: "ls" })).toBe("deny");
  });

  // The rule the whole design turns on: content the user did not write is in
  // the conversation, so no approval may be assumed.
  it("forces an ask once tainted, even where it would otherwise allow", () => {
    expect(decide({ ...base, risk: "read_local", readLocalApproved: true, tainted: true })).toBe("ask");
    expect(decide({ ...base, risk: "write", tainted: true })).toBe("ask");
  });

  it("still denies a non-allowlisted command when tainted", () => {
    expect(decide({ ...base, risk: "execute", tainted: true, command: "curl x" })).toBe("deny");
  });
});

describe("shellCommandAllowed", () => {
  it("matches on the first word", () => {
    expect(shellCommandAllowed("ls -la /tmp", ["ls"])).toBe(true);
    expect(shellCommandAllowed("rm -rf /", ["ls"])).toBe(false);
  });

  // An allowlisted first word must not become a licence for whatever follows a
  // separator.
  it("refuses a command that chains a second one", () => {
    expect(shellCommandAllowed("ls; rm -rf /", ["ls"])).toBe(false);
    expect(shellCommandAllowed("ls && curl evil.example", ["ls"])).toBe(false);
    expect(shellCommandAllowed("ls | sh", ["ls"])).toBe(false);
    expect(shellCommandAllowed("ls $(rm -rf /)", ["ls"])).toBe(false);
    expect(shellCommandAllowed("ls `whoami`", ["ls"])).toBe(false);
    expect(shellCommandAllowed("ls > /etc/passwd", ["ls"])).toBe(false);
    // Whitespace characters that \s matches but plain-space tokenisation does not.
    expect(shellCommandAllowed("ls\rrm -rf /", ["ls"])).toBe(false); // carriage return
    expect(shellCommandAllowed("ls\frm -rf /", ["ls"])).toBe(false); // form feed
    expect(shellCommandAllowed("ls\vrm -rf /", ["ls"])).toBe(false); // vertical tab
    expect(shellCommandAllowed("ls rm -rf /", ["ls"])).toBe(false); // non-breaking space (U+00A0)
    expect(shellCommandAllowed("ls rm -rf /", ["ls"])).toBe(false); // line separator (U+2028)
    expect(shellCommandAllowed("ls　rm -rf /", ["ls"])).toBe(false); // ideographic space (U+3000)
    expect(shellCommandAllowed("ls\trm -rf /", ["ls"])).toBe(false); // tab
  });

  it("refuses an empty command", () => {
    expect(shellCommandAllowed("   ", ["ls"])).toBe(false);
  });
});

describe("parseAllowlist", () => {
  it("splits, trims and drops blanks", () => {
    expect(parseAllowlist(" ls , git ,, ")).toEqual(["ls", "git"]);
  });

  it("treats an unset preference as an empty allowlist", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
  });
});

describe("decide — outbound network", () => {
  const remote = { ...base, risk: "read_remote" as const };

  it("allows an outbound fetch in a clean session", () => {
    expect(decide(remote)).toBe("allow");
  });

  // Once outside content is in the conversation, a URL the model chose is a
  // channel out: the query string can carry whatever it has already read.
  it("asks before an outbound fetch once the session is tainted", () => {
    expect(decide({ ...remote, tainted: true })).toBe("ask");
  });

  it("still allows local reads when tainted", () => {
    expect(decide({ ...base, risk: "read", tainted: true })).toBe("allow");
  });

  it("denies outbound fetches when write tools are off only if they write", () => {
    expect(decide({ ...remote, writeToolsEnabled: false })).toBe("allow");
  });
});
