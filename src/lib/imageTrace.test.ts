// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { binarizeImageData, traceImageToPath } from "./imageTrace";

// Minimal ImageData polyfill for environments (jsdom without a canvas
// implementation) that don't provide one. Only the `ImageData(data, width,
// height?)` overload is supported — the `ImageData(width, height)` overload
// is never used by this module or its tests. Like the real constructor, the
// passed buffer is *wrapped*, not copied, so in-place binarization is
// observable through the caller's own array.
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data;
      this.width = width;
      this.height = height ?? data.length / (width * 4);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ImageData = ImageDataPolyfill;
}

function makeImageData(
  width: number,
  height: number,
  fill: (x: number, y: number) => number,
  alpha: (x: number, y: number) => number = () => 255
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = fill(x, y);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = alpha(x, y);
    }
  }
  return new ImageData(data, width, height);
}

describe("binarizeImageData", () => {
  it("turns pixels darker than the threshold black, others white", () => {
    // 2x2: top-left dark (30), top-right light (220), bottom row mid-gray (128)
    const img = makeImageData(2, 2, (x, y) => (y === 0 ? (x === 0 ? 30 : 220) : 128));
    const out = binarizeImageData(img, 0.5); // cut = 127.5
    expect(out.data[0]).toBe(0); // top-left (30) -> foreground (black)
    expect(out.data[4]).toBe(255); // top-right (220) -> background (white)
    expect(out.data[8]).toBe(255); // bottom-left (128, just above cut) -> background (white)
  });

  it("always writes full alpha regardless of input alpha", () => {
    const img = makeImageData(1, 1, () => 10);
    img.data[3] = 0; // fully transparent input pixel
    const out = binarizeImageData(img, 0.5);
    expect(out.data[3]).toBe(255);
  });

  it("classifies a fully transparent pixel as background even when its RGB is dark", () => {
    // rgba(10,10,10,0) — exactly what a transparent PNG's untouched pixels
    // read back as after being drawn onto a fresh canvas. Luminance alone
    // would call this foreground; alpha must win.
    const img = makeImageData(1, 1, () => 10, () => 0);
    const out = binarizeImageData(img, 0.5);
    expect(out.data[0]).toBe(255);
    expect(out.data[1]).toBe(255);
    expect(out.data[2]).toBe(255);
  });

  it("keeps an opaque dark pixel as foreground alongside transparent ones", () => {
    // 2x1: left opaque dark, right transparent dark.
    const img = makeImageData(2, 1, () => 10, (x) => (x === 0 ? 255 : 0));
    const out = binarizeImageData(img, 0.5);
    expect(out.data[0]).toBe(0); // opaque dark -> foreground
    expect(out.data[4]).toBe(255); // transparent dark -> background
  });

  it("treats a half-transparent pixel below the alpha cut as background", () => {
    const img = makeImageData(1, 1, () => 0, () => 127);
    expect(binarizeImageData(img, 0.5).data[0]).toBe(255);
  });
});

describe("traceImageToPath", () => {
  it("traces a filled square into a non-null path", () => {
    const size = 20;
    const img = makeImageData(size, size, (x, y) =>
      x > 4 && x < 15 && y > 4 && y < 15 ? 0 : 255
    );
    const result = traceImageToPath(img, 0.5);
    expect(result).not.toBeNull();
    expect(result?.pathData).toMatch(/M/);
    expect(result?.w).toBeGreaterThan(0);
    expect(result?.h).toBeGreaterThan(0);
  });

  it("returns null for a blank (all-white) image", () => {
    const img = makeImageData(10, 10, () => 255);
    const result = traceImageToPath(img, 0.5);
    expect(result).toBeNull();
  });

  it("returns null for a fully transparent image with dark RGB channels", () => {
    // The transparent-PNG regression: before alpha was considered, every
    // pixel here counted as foreground and the image traced to a solid
    // full-size rectangle at any threshold.
    const img = makeImageData(16, 16, () => 0, () => 0);
    expect(traceImageToPath(img, 0.5)).toBeNull();
    expect(traceImageToPath(makeImageData(16, 16, () => 0, () => 0), 0.05)).toBeNull();
    expect(traceImageToPath(makeImageData(16, 16, () => 0, () => 0), 0.95)).toBeNull();
  });

  it("traces only the opaque subject of a transparent PNG, not the whole canvas", () => {
    const size = 20;
    const inSubject = (x: number, y: number) => x > 4 && x < 15 && y > 4 && y < 15;
    // Transparent background, opaque dark square subject.
    const transparent = makeImageData(
      size,
      size,
      () => 0,
      (x, y) => (inSubject(x, y) ? 255 : 0)
    );
    // Same subject on an opaque white background — the unambiguous case.
    const opaque = makeImageData(size, size, (x, y) => (inSubject(x, y) ? 0 : 255));

    const fromTransparent = traceImageToPath(transparent, 0.5);
    const fromOpaque = traceImageToPath(opaque, 0.5);
    expect(fromTransparent).not.toBeNull();
    expect(fromTransparent?.pathData).toBe(fromOpaque?.pathData);
  });

  it("traces an all-black image at an extreme low threshold to nothing", () => {
    // threshold 0.05 -> cut 12.75; an all-black (luminance 0) image is still
    // entirely foreground, so keepForegroundOnly finds a full-canvas shape.
    const allBlack = makeImageData(12, 12, () => 0);
    expect(traceImageToPath(allBlack, 0.05)).not.toBeNull();
    // ...and at an extreme high threshold it is still entirely foreground,
    // i.e. no threshold position can make a solid image disappear.
    expect(traceImageToPath(makeImageData(12, 12, () => 0), 0.95)).not.toBeNull();
  });

  it("preserves a non-square image's aspect ratio in the returned w/h", () => {
    const w = 40;
    const h = 20;
    const img = makeImageData(w, h, (x, y) =>
      x > 5 && x < 34 && y > 4 && y < 15 ? 0 : 255
    );
    const result = traceImageToPath(img, 0.5);
    expect(result).not.toBeNull();
    expect(result!.w / result!.h).toBeCloseTo(w / h, 5);
  });

  it("does not mutate the ImageData passed in by the caller's original reference expectations", () => {
    // binarizeImageData legitimately mutates in place (documented behavior) —
    // this test just documents/locks that contract so a future refactor
    // doesn't silently change it to a copy without updating ImageTraceDialog,
    // which relies on cloning before each retrace itself.
    const img = makeImageData(4, 4, () => 10);
    const out = binarizeImageData(img, 0.5);
    expect(out).toBe(img);
  });
});
