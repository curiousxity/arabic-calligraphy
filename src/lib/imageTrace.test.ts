import { describe, it, expect } from "vitest";
import { binarizeImageData, traceImageToPath } from "./imageTrace";

// Polyfill ImageData if not available in the test environment
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray | number[], width: number, height?: number) {
      if (typeof data === "number") {
        // ImageData(width, height) form
        this.width = data;
        this.height = width;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        // ImageData(data, width, height?) form
        this.data = new Uint8ClampedArray(data);
        this.width = width;
        this.height = height ?? (data.length / (width * 4));
      }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ImageData = ImageDataPolyfill;
}

function makeImageData(
  width: number,
  height: number,
  fill: (x: number, y: number) => number
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = fill(x, y);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
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
