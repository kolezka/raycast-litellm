import { readFile as read, writeFile as write } from "node:fs/promises";
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { forDisplay } from "../display";
import { Tool } from "../types";

const MAX_CHARS = 100_000;

/** How much of a path is shown in a dialog before it's cut off. */
const MAX_PATH_PREVIEW_CHARS = 300;

/** How much of a write's content is shown in the confirmation dialog. */
const MAX_CONTENT_PREVIEW_CHARS = 500;

/**
 * What deciding whether `readFile`/`writeFile` may proceed comes down to:
 * either the resolved path to actually operate on (`overwriting` only ever
 * set for a write, true when something is already there to be replaced), or
 * the reason it can't happen at all — in two renderings. `reason` is what
 * `run()` throws: built from the raw, unbounded path(s), because nothing
 * about a thrown `Error` risks pushing text out of a dialog. `displayReason`
 * is what `describe()` shows: the *same* sentence, but built with each path
 * individually length-capped and control-character-escaped before
 * composition — see `reasonPair` below for why "individually" matters.
 *
 * `describe()` and `run()` both compute this by calling the *same* function
 * (`planRead`/`planWrite` below) rather than each running their own version
 * of the checks — the two are structurally unable to disagree about whether
 * a call will succeed, because there is only one place that decides it.
 */
type Plan = { ok: true; target: string; overwriting?: boolean } | { ok: false; reason: string; displayReason: string };

/**
 * Builds both renderings of a refusal reason from one template, evaluated
 * twice with a different `cap` function each time. This is what makes
 * "cap each path individually, before composing" true by construction
 * rather than by remembering to do it at every call site: `displayReason`
 * is not `reason` truncated after the fact (that was the bug — a long path
 * could consume the whole budget and carry the trailing "is a symlink to
 * ..."/"is not an absolute path..." explanation off the end with it). Every
 * path is capped on its own, in place, before the sentence around it is
 * assembled, the same way `describeLocation` caps `path` and `resolved`
 * separately rather than capping their concatenation.
 */
function reasonPair(template: (cap: (text: string) => string) => string): { reason: string; displayReason: string } {
  return {
    reason: template((text) => text),
    displayReason: template((text) => forDisplay(text, MAX_PATH_PREVIEW_CHARS)),
  };
}

/**
 * The path the filesystem will actually use for `path`: the parent
 * directory's realpath (following any symlinked *ancestor* — e.g. macOS's
 * `/var` -> `/private/var`, present under every path built on `os.tmpdir()`
 * on this platform) joined with the given basename.
 *
 * Deliberately stops at the parent rather than calling `realpathSync` on the
 * full path: the final component of a write's target often doesn't exist
 * yet, and `realpathSync` requires the whole path to. `basename`/`dirname`
 * both ignore a trailing slash, which is what makes this immune to the
 * classic "trailing slash defeats an lstat-based symlink check" trick — the
 * write below never sees a path with a trailing slash to be confused by.
 *
 * This does not resolve the final component itself if that component is a
 * symlink (a symlink *file*, as opposed to a symlinked ancestor directory) —
 * that case is handled separately, and deliberately refused rather than
 * silently followed, in `planWrite`.
 */
function resolvedPath(path: string): string {
  const parent = dirname(path);
  return join(realpathSync(parent), basename(path));
}

/**
 * Shared by `planRead` and `planWrite`: the absolute-path requirement and
 * parent-directory resolution neither tool can skip. Returns a plan rather
 * than throwing so `describe()` can report a refusal as plainly as `run()`
 * enacts it, instead of either duplicating these checks (and risking the two
 * drifting apart) or crashing the confirmation dialog.
 */
function resolve(path: string): Plan {
  if (!isAbsolute(path)) {
    return { ok: false, ...reasonPair((cap) => `${cap(path)} is not an absolute path. Pass an absolute path.`) };
  }
  try {
    return { ok: true, target: resolvedPath(path) };
  } catch {
    const parent = dirname(path);
    return { ok: false, ...reasonPair((cap) => `${cap(parent)} does not exist.`) };
  }
}

function planRead(path: string): Plan {
  return resolve(path);
}

/**
 * Adds `writeFile`'s one extra rule on top of `resolve()`: refuse outright
 * when the resolved path's final component is itself a symlink, rather than
 * writing through it to whatever it points at. A symlinked *ancestor*
 * directory was already resolved away by `resolve()` above and is not
 * refused — only this last hop is, and only when it is itself a link.
 */
function planWrite(path: string): Plan {
  const base = resolve(path);
  if (!base.ok) return base;
  const target = base.target;

  // lstat (not stat) so a symlink is seen as itself, not silently followed
  // to whatever it points at — a missing target is fine (nothing to guard
  // against, and nothing to overwrite), anything else is a real file this
  // write would replace.
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    stat = undefined;
  }
  if (stat?.isSymbolicLink()) {
    // readlinkSync, not realpathSync: the latter would also fold in the
    // ancestor resolution `resolve()` already applied, muddying which hop
    // this particular link is responsible for. This names exactly what the
    // link itself points to.
    const linkTarget = readlinkSync(target);
    return {
      ok: false,
      ...reasonPair(
        (cap) =>
          `${cap(target)} is a symlink to ${cap(linkTarget)}; refusing to write through it. Pass the real path if that is what you meant.`,
      ),
    };
  }

  return { ok: true, target, overwriting: stat !== undefined };
}

/** `path` verbatim (sanitised) when resolution changed nothing; both, named, when it did. */
function describeLocation(path: string, resolved: string): string {
  if (resolved === path) return forDisplay(resolved, MAX_PATH_PREVIEW_CHARS);
  return `${forDisplay(path, MAX_PATH_PREVIEW_CHARS)} (which resolves to ${forDisplay(resolved, MAX_PATH_PREVIEW_CHARS)})`;
}

// No further truncation here: `displayReason` was already built by
// `reasonPair` with each embedded path capped individually before the
// sentence around it was composed, the same way `describeLocation` above
// caps `path` and `resolved` separately rather than capping their
// concatenation. Re-truncating the finished sentence is exactly the bug
// this replaced — a long path could consume the whole budget and take the
// trailing explanation ("is a symlink to ...", "is not an absolute path...")
// down with it.
function describeRefusal(displayReason: string): string {
  return `This will be refused because ${displayReason}`;
}

export const readFile: Tool = {
  risk: "read_local",
  // A file's contents are no more authored by the user than a web page is.
  taints: true,
  definition: {
    name: "read_file",
    description: "Read a text file from disk and return its contents.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute path to the file" } },
      required: ["path"],
    },
  },
  async describe(input) {
    const plan = planRead(String(input.path));
    if (!plan.ok) return describeRefusal(plan.displayReason);
    return `Read ${describeLocation(String(input.path), plan.target)}.`;
  },
  async run(input) {
    const path = String(input.path);
    const plan = planRead(path);
    if (!plan.ok) throw new Error(plan.reason);
    const target = plan.target;
    let text: string;
    try {
      text = await read(target, "utf8");
    } catch {
      throw new Error(`Could not read ${basename(target)} at ${describeLocation(path, target)}.`);
    }
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[truncated]` : text;
  },
};

export const writeFile: Tool = {
  risk: "write",
  taints: false,
  definition: {
    name: "write_file",
    description: "Write text to a file, replacing what is there.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to write" },
        content: { type: "string", description: "The full new contents" },
      },
      required: ["path", "content"],
    },
  },
  async describe(input) {
    const path = String(input.path);
    const content = String(input.content);
    const plan = planWrite(path);
    if (!plan.ok) return describeRefusal(plan.displayReason);
    const verb = plan.overwriting ? "Overwrite" : "Write";
    const preview =
      content.length > MAX_CONTENT_PREVIEW_CHARS
        ? `${content.slice(0, MAX_CONTENT_PREVIEW_CHARS)}\n[truncated]`
        : content;
    return [`${verb} ${content.length} characters at ${describeLocation(path, plan.target)}:`, "", preview].join("\n");
  },
  async run(input) {
    const path = String(input.path);
    const plan = planWrite(path);
    if (!plan.ok) throw new Error(plan.reason);
    const target = plan.target;

    // Residual, out of scope here: `planWrite`'s lstat and this write are two
    // separate syscalls, not one atomic operation — and now that `describe()`
    // runs the identical resolution to build the confirmation dialog, that
    // resolution happens *twice*: once before the dialog is shown, once here
    // after the user clicks. The gap between "what was disclosed" and "what
    // actually runs" is however long the user takes to read the dialog and
    // click — human-scale, not the microseconds a single lstat-then-write
    // pair would otherwise suggest. A symlink swapped in by a concurrent
    // local process at any point in that window would slip past both checks
    // and still get followed. Closing that needs a different mechanism
    // (e.g. opening with O_NOFOLLOW and writing through the resulting
    // descriptor) than resolving a path string ahead of time can offer.
    await write(target, String(input.content), "utf8");
    return `Wrote ${String(input.content).length} characters to ${describeLocation(path, target)}.`;
  },
};
