import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const finder = { items: [] as { path: string }[], throws: undefined as Error | undefined };
const clip = { file: undefined as string | undefined };

vi.mock("@raycast/api", () => ({
  getSelectedFinderItems: async () => {
    if (finder.throws) throw finder.throws;
    return finder.items;
  },
  Clipboard: { read: async () => ({ file: clip.file }) },
}));

const { imageMimeType, MAX_IMAGE_BYTES, toDataUri, validateImageSize, getCommandImages } =
  await import("../src/lib/ui/image");

describe("imageMimeType", () => {
  it("maps the formats the vision models accept", () => {
    expect(imageMimeType("/a/b/shot.png")).toBe("image/png");
    expect(imageMimeType("/a/b/photo.jpg")).toBe("image/jpeg");
    expect(imageMimeType("/a/b/photo.jpeg")).toBe("image/jpeg");
    expect(imageMimeType("/a/b/anim.gif")).toBe("image/gif");
    expect(imageMimeType("/a/b/pic.webp")).toBe("image/webp");
  });

  it("ignores case, since Finder happily yields .PNG", () => {
    expect(imageMimeType("/a/b/Screenshot.PNG")).toBe("image/png");
  });

  // Sending a PDF or a .mov as an image wastes a round trip and returns a
  // confusing model error rather than a clear local one.
  it("rejects what is not a raster image", () => {
    expect(imageMimeType("/a/b/paper.pdf")).toBeUndefined();
    expect(imageMimeType("/a/b/clip.mov")).toBeUndefined();
    expect(imageMimeType("/a/b/notes.txt")).toBeUndefined();
    expect(imageMimeType("/a/b/noextension")).toBeUndefined();
  });

  it("does not match an extension appearing mid-path", () => {
    expect(imageMimeType("/png/holiday/notes.txt")).toBeUndefined();
  });
});

describe("validateImageSize", () => {
  it("accepts a file within the cap", () => {
    expect(validateImageSize(1_000, "shot.png")).toBeUndefined();
  });

  it("names the file and the cap when it is too large", () => {
    const problem = validateImageSize(MAX_IMAGE_BYTES + 1, "huge.png");
    expect(problem).toMatch(/huge\.png/);
    expect(problem).toMatch(/20/);
  });

  it("rejects an empty file rather than sending an empty data URI", () => {
    expect(validateImageSize(0, "empty.png")).toMatch(/empty/i);
  });
});

describe("toDataUri", () => {
  it("builds the data URI shape the image_url part expects", () => {
    expect(toDataUri("image/png", Buffer.from("hi"))).toBe("data:image/png;base64,aGk=");
  });
});

describe("getCommandImages", () => {
  const dir = mkdtempSync(join(tmpdir(), "litellm-image-"));
  const png = join(dir, "shot.png");
  const notImage = join(dir, "notes.txt");
  writeFileSync(png, Buffer.from("hi"));
  writeFileSync(notImage, "hello");

  beforeEach(() => {
    finder.items = [];
    finder.throws = undefined;
    clip.file = undefined;
  });

  it("reads the Finder selection", async () => {
    finder.items = [{ path: png }];
    expect(await getCommandImages()).toEqual([{ dataUri: "data:image/png;base64,aGk=", mimeType: "image/png" }]);
  });

  it("reads every selected image, not just the first", async () => {
    finder.items = [{ path: png }, { path: png }];
    expect(await getCommandImages()).toHaveLength(2);
  });

  // Finder throws whenever it is not the frontmost app, which is the normal
  // case when the image came from the clipboard — it must not abort the lookup.
  it("falls back to the clipboard when Finder is not frontmost", async () => {
    finder.throws = new Error("Finder isn't the frontmost application");
    clip.file = png;
    expect(await getCommandImages()).toHaveLength(1);
  });

  it("falls back to the clipboard when the selection holds no images", async () => {
    finder.items = [{ path: notImage }];
    clip.file = png;
    expect(await getCommandImages()).toHaveLength(1);
  });

  it("accepts a file:// clipboard URL with escaped characters", async () => {
    const spaced = join(dir, "my shot.png");
    writeFileSync(spaced, Buffer.from("hi"));
    clip.file = `file://${spaced.replace(/ /g, "%20")}`;
    expect(await getCommandImages()).toHaveLength(1);
  });

  it("throws a directing message when there is no image anywhere", async () => {
    await expect(getCommandImages()).rejects.toThrow(/Select one or more images in Finder/);
  });
});
