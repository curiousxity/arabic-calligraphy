import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextPatch, bumpJsonFile, bumpAll } from "./bumpVersion.mjs";

describe("nextPatch", () => {
  it("increments the patch", () => {
    expect(nextPatch("0.1.0")).toBe("0.1.1");
    expect(nextPatch("2.3.9")).toBe("2.3.10");
  });

  it("does not roll over into minor at 9", () => {
    // 0.1.9 -> 0.1.10, never 0.2.0: minor and major stay deliberate.
    expect(nextPatch("0.1.9")).toBe("0.1.10");
  });

  it("tolerates surrounding whitespace", () => {
    expect(nextPatch(" 1.0.0 ")).toBe("1.0.1");
  });

  it("refuses anything that is not a plain three-part version", () => {
    // Better to fail the commit loudly than to silently mangle a
    // prerelease or a range into nonsense.
    for (const bad of ["1.0", "1.0.0-beta.1", "^1.0.0", "v1.0.0", "", "abc"]) {
      expect(() => nextPatch(bad)).toThrow();
    }
  });
});

describe("bumpJsonFile", () => {
  const tmp = () => mkdtempSync(join(tmpdir(), "bump-"));

  it("rewrites only the version line, preserving formatting", () => {
    const dir = tmp();
    const p = join(dir, "package.json");
    const original = '{\n  "name": "x",\n  "version": "0.1.0",\n  "private": true\n}\n';
    writeFileSync(p, original);

    expect(bumpJsonFile(p, "0.1.1")).toBe(true);
    expect(readFileSync(p, "utf8")).toBe(
      '{\n  "name": "x",\n  "version": "0.1.1",\n  "private": true\n}\n'
    );
  });

  it("reports false when there is no version field to change", () => {
    const dir = tmp();
    const p = join(dir, "package.json");
    writeFileSync(p, '{\n  "name": "x"\n}\n');
    expect(bumpJsonFile(p, "0.1.1")).toBe(false);
  });
});

describe("bumpAll", () => {
  it("bumps package.json and the lockfile's own two version fields together", () => {
    const dir = mkdtempSync(join(tmpdir(), "bump-"));
    writeFileSync(join(dir, "package.json"), '{\n  "name": "x",\n  "version": "0.1.0"\n}\n');
    writeFileSync(
      join(dir, "package-lock.json"),
      '{\n  "name": "x",\n  "version": "0.1.0",\n  "lockfileVersion": 3,\n' +
        '  "packages": {\n    "": {\n      "name": "x",\n      "version": "0.1.0"\n    },\n' +
        '    "node_modules/dep": {\n      "version": "9.9.9"\n    }\n  }\n}\n'
    );

    const result = bumpAll(dir);
    expect(result).toMatchObject({ current: "0.1.0", next: "0.1.1" });
    expect(result.changed).toHaveLength(2);

    const lock = readFileSync(join(dir, "package-lock.json"), "utf8");
    // Both of the project's own version fields move...
    expect(lock.match(/"version": "0\.1\.1"/g)).toHaveLength(2);
    // ...and a dependency's version is left strictly alone.
    expect(lock).toContain('"version": "9.9.9"');
  });

  it("works when there is no lockfile", () => {
    const dir = mkdtempSync(join(tmpdir(), "bump-"));
    writeFileSync(join(dir, "package.json"), '{\n  "version": "1.0.0"\n}\n');
    expect(bumpAll(dir).changed).toHaveLength(1);
  });
});
