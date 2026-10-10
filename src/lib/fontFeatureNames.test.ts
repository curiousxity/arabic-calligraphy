/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readFeatureNames } from "./fontFeatureNames";

function fontBytes(file: string): ArrayBuffer {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const b = fs.readFileSync(path.resolve(dir, "../../public/fonts", file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe("readFeatureNames", () => {
  it("reads Ruqaa's stylistic-set names", () => {
    const names = readFeatureNames(fontBytes("Ruqaa.ttf"));
    expect(names.get("ss01")).toBe("Looped Haa");
    expect(names.get("ss03")).toBe("Tailed Noon");
    expect(names.get("ss08")).toBe("Alternate Sukun");
  });

  it("reads Amiri's", () => {
    expect(readFeatureNames(fontBytes("Amiri.ttf")).get("ss04")).toBe(
      "Alternate, more naskh-like, Gaf form"
    );
  });

  it("is empty for a font without named sets", () => {
    expect(readFeatureNames(fontBytes("Thuluth.ttf")).size).toBe(0);
  });

  it("never throws on garbage", () => {
    expect(readFeatureNames(new ArrayBuffer(3)).size).toBe(0);
    expect(readFeatureNames(new Uint8Array(64).fill(255).buffer).size).toBe(0);
  });
});
