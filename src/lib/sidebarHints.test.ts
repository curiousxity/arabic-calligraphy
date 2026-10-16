/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { SIDEBAR_HINTS } from "./sidebarHints";

// Hints are looked up by visible label, so renaming a label silently drops
// its tooltip. Every key must still appear as a label or title in the UI.
describe("SIDEBAR_HINTS", () => {
  it("only describes labels that exist", () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../components");
    const source = fs
      .readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    const missing = Object.keys(SIDEBAR_HINTS).filter((label) => !source.includes(`"${label}"`));
    expect(missing).toEqual([]);
  });
});
