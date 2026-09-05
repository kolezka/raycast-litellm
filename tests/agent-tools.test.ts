import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const clipboard = { copied: "", pasted: "" };
vi.mock("@raycast/api", () => ({
  Clipboard: {
    copy: async (t: string) => void (clipboard.copied = t),
    paste: async (t: string) => void (clipboard.pasted = t),
    readText: async () => "",
    read: async () => ({}),
  },
  getSelectedText: async () => "",
  BrowserExtension: { getContent: async () => "" },
}));

const { readFile, writeFile } = await import("../src/lib/agent/tools/files");
const { writeClipboard, runShell } = await import("../src/lib/agent/tools/system");

const dir = mkdtempSync(join(tmpdir(), "agent-tools-"));

describe("readFile", () => {
  it("returns the file's text", async () => {
    const path = join(dir, "a.txt");
    writeFileSync(path, "hello");
    expect(await readFile.run({ path })).toBe("hello");
  });

  it("says which file is missing rather than leaking a raw errno", async () => {
    await expect(readFile.run({ path: join(dir, "nope.txt") })).rejects.toThrow(/nope\.txt/);
  });

  it("rejects a relative path", async () => {
    await expect(readFile.run({ path: "relative.txt" })).rejects.toThrow(/absolute/i);
  });

  it("is marked as tainting, since file contents are not ours", () => {
    expect(readFile.taints).toBe(true);
    expect(readFile.risk).toBe("read_local");
  });
});

describe("writeFile", () => {
  it("writes and reports the path", async () => {
    const path = join(dir, "out.txt");
    const result = await writeFile.run({ path, content: "written" });
    expect(readFileSync(path, "utf8")).toBe("written");
    expect(result).toMatch(/out\.txt/);
  });

  it("is an unconditional write risk", () => {
    expect(writeFile.risk).toBe("write");
  });

  it("rejects a relative path", async () => {
    await expect(writeFile.run({ path: "relative.txt", content: "x" })).rejects.toThrow(/absolute/i);
  });

  it("refuses to write through a symlink, naming both the link and its real target", async () => {
    const target = join(dir, "real-target.txt");
    writeFileSync(target, "original");
    const link = join(dir, "link-to-target.txt");
    symlinkSync(target, link);

    await expect(writeFile.run({ path: link, content: "hacked" })).rejects.toThrow(
      new RegExp(`${link}.*${target}|${target}.*${link}`, "s"),
    );
    expect(readFileSync(target, "utf8")).toBe("original");
  });

  it("surfaces a symlinked PARENT directory in describe(), and writes land at the resolved location", async () => {
    // lstat on the final component (the check above) never sees this: the
    // symlink sits one level up, in the directory the file lives in, not in
    // the file itself.
    const realDir = mkdtempSync(join(dir, "real-"));
    const linkDir = join(dir, "linkdir");
    symlinkSync(realDir, linkDir);
    const inputPath = join(linkDir, "target.txt");
    const resolvedTarget = join(realpathSync(realDir), "target.txt");

    const description = await writeFile.describe?.({ path: inputPath, content: "via symlinked dir" });
    expect(description).toContain(inputPath);
    expect(description).toContain(resolvedTarget);

    const result = await writeFile.run({ path: inputPath, content: "via symlinked dir" });
    expect(result).toContain(resolvedTarget);
    expect(readFileSync(join(realDir, "target.txt"), "utf8")).toBe("via symlinked dir");
  });

  it("a trailing slash on the path does not change the outcome", async () => {
    const path = join(dir, "trailing.txt");
    const result = await writeFile.run({ path: `${path}/`, content: "no trailing surprise" });
    expect(readFileSync(path, "utf8")).toBe("no trailing surprise");
    expect(result).toContain("trailing.txt");
  });

  it("an ordinary absolute path with no symlinked ancestor still just works", async () => {
    const path = join(dir, "ordinary.txt");
    const result = await writeFile.run({ path, content: "plain" });
    expect(readFileSync(path, "utf8")).toBe("plain");
    expect(result).toContain("ordinary.txt");
  });

  it("describe() names an existing target as an overwrite", async () => {
    const path = join(dir, "already-there.txt");
    writeFileSync(path, "old");
    const description = await writeFile.describe?.({ path, content: "new" });
    expect(description).toMatch(/overwrite/i);
  });

  it("describe() does not call a brand-new file an overwrite", async () => {
    const path = join(dir, "brand-new.txt");
    const description = await writeFile.describe?.({ path, content: "new" });
    expect(description).not.toMatch(/overwrite/i);
  });

  // Regression: describe() used to check existence with existsSync (follows
  // symlinks) while run() separately lstat-refused the same path — so the
  // dialog promised an overwrite that never happened. Both must now agree,
  // because both call the same planWrite() under the hood.
  it("describe() refuses a final-component symlink instead of promising an overwrite that run() then refuses", async () => {
    const target = join(dir, "real-target-agree.txt");
    writeFileSync(target, "original");
    const link = join(dir, "link-to-target-agree.txt");
    symlinkSync(target, link);

    const description = await writeFile.describe?.({ path: link, content: "hacked" });
    expect(description).toMatch(/refused/i);
    expect(description).not.toMatch(/overwrite/i);

    await expect(writeFile.run({ path: link, content: "hacked" })).rejects.toThrow(/refus/i);
  });

  // Regression: describe() used to resolve the path before checking it was
  // absolute, so a relative path produced a confident "resolves to ..." line
  // built from the host's cwd, and run() then rejected the same call.
  it("describe() refuses a relative path the same way run() does, instead of resolving it against cwd", async () => {
    const description = await writeFile.describe?.({ path: "relative.txt", content: "x" });
    expect(description).toMatch(/refused/i);
    expect(description).toMatch(/absolute/i);
    expect(description).not.toMatch(/resolves to/i);
  });

  it("describe() includes a preview of the content that will be written", async () => {
    const path = join(dir, "preview.txt");
    const description = await writeFile.describe?.({ path, content: "hello world" });
    expect(description).toContain("hello world");
  });

  it("describe() truncates a long content preview with an explicit marker", async () => {
    const path = join(dir, "preview-long.txt");
    const longContent = "x".repeat(5000);
    const description = await writeFile.describe?.({ path, content: longContent });
    expect(description).toBeDefined();
    expect(description!.length).toBeLessThan(longContent.length);
    expect(description).toMatch(/truncat/i);
  });

  it("escapes a control character (an embedded newline) in a path rendered into describe()'s message", async () => {
    const trickyPath = join(dir, "evil\nfile.txt");
    const description = await writeFile.describe?.({ path: trickyPath, content: "x" });
    // The raw newline must not survive — it would push the rest of the
    // message (the "resolves to" clause, the content preview) out of view.
    expect(description).toContain("evil\\nfile.txt");
  });

  it("caps the length of a path rendered into describe()'s message", async () => {
    const longName = "x".repeat(1000) + ".txt";
    const longPath = join(dir, longName);
    const description = await writeFile.describe?.({ path: longPath, content: "y" });
    expect(description).toBeDefined();
    expect(description!.length).toBeLessThan(longPath.length);
  });

  // Regression: describeRefusal() used to cap the whole *composed* sentence
  // after the path was already interpolated into it, so a long enough path
  // consumed the entire budget and took the trailing "is not an absolute
  // path..."/"is a symlink to..." explanation down with it — the dialog
  // stayed truthful ("this will be refused") but lost the *why*. Each path
  // is now capped individually before the sentence is composed, mirroring
  // describeLocation, so the explanation survives regardless of length.
  it("keeps the refusal explanation intact when the offending path itself is long (relative-path case)", async () => {
    const longRelativePath = "x".repeat(404); // no leading slash: relative, not exotic
    const description = await writeFile.describe?.({ path: longRelativePath, content: "z" });
    expect(description).toMatch(/refused/i);
    expect(description).toMatch(/absolute/i);
  });

  it("keeps the refusal explanation intact when the offending path itself is long (symlink case)", async () => {
    // An ordinary deep directory tree — ~480 characters of nested path is
    // unremarkable for a real project, not an exotic edge case.
    let nested = dir;
    while (nested.length < 480) {
      nested = join(nested, "nested-segment");
      mkdirSync(nested);
    }
    const target = join(nested, "real.txt");
    writeFileSync(target, "original");
    const link = join(nested, "link.txt");
    symlinkSync(target, link);

    const description = await writeFile.describe?.({ path: link, content: "hacked" });
    expect(description).toMatch(/refused/i);
    expect(description).toMatch(/symlink/i);
  });
});

describe("readFile.describe", () => {
  it("names the resolved path when it differs from the input", async () => {
    const realDir = mkdtempSync(join(dir, "real-read-"));
    const linkDir = join(dir, "linkdir-read");
    symlinkSync(realDir, linkDir);
    writeFileSync(join(realDir, "via-link.txt"), "content");
    const inputPath = join(linkDir, "via-link.txt");
    const resolvedTarget = join(realpathSync(realDir), "via-link.txt");

    const description = await readFile.describe?.({ path: inputPath });
    expect(description).toContain(inputPath);
    expect(description).toContain(resolvedTarget);
  });

  it("refuses a relative path the same way run() does, instead of resolving it against cwd", async () => {
    const description = await readFile.describe?.({ path: "relative.txt" });
    expect(description).toMatch(/refused/i);
    expect(description).toMatch(/absolute/i);
    expect(description).not.toMatch(/resolves to/i);
  });
});

describe("writeClipboard", () => {
  it("copies the text", async () => {
    await writeClipboard.run({ text: "copied text" });
    expect(clipboard.copied).toBe("copied text");
  });
});

describe("runShell", () => {
  it("returns stdout", async () => {
    expect(await runShell.run({ command: "echo hi" })).toContain("hi");
  });

  it("reports a non-zero exit with its stderr instead of returning silence", async () => {
    await expect(runShell.run({ command: "ls /definitely-not-here-xyz" })).rejects.toThrow(/exit|No such file/i);
  });

  it("is the only execute-risk tool", () => {
    expect(runShell.risk).toBe("execute");
  });

  it("taints, since a command's stdout is not content we authored", () => {
    expect(runShell.taints).toBe(true);
  });
});
