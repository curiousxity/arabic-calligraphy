/**
 * Bumps package.json's patch version. Run from the pre-commit hook so the
 * number in the sidebar always moves with the code, without anyone having
 * to remember to bump it.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

/** `1.2.3` -> `1.2.4`. Throws on anything that is not a plain three-part semver. */
export function nextPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!m) throw new Error(`not a plain semver version: ${version}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/**
 * Rewrites `version` in a JSON file, touching nothing else — a regex on the
 * one line rather than a parse/serialize round trip, so the file's existing
 * key order, indentation, and trailing newline survive untouched.
 */
export function bumpJsonFile(path, next) {
  const before = readFileSync(path, "utf8");
  const after = before.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${next}$2`);
  if (after === before) return false;
  writeFileSync(path, after);
  return true;
}

export function bumpAll(root = ".") {
  const pkgPath = `${root}/package.json`;
  const current = JSON.parse(readFileSync(pkgPath, "utf8")).version;
  const next = nextPatch(current);

  const changed = [pkgPath].filter((p) => bumpJsonFile(p, next));

  // The lockfile repeats the version — once at the top level and once on
  // the root package entry (`packages[""]`) — and npm warns when they
  // disagree. Those two are addressed by key rather than by text position,
  // so a dependency that happens to share the project's version string is
  // never touched. Parsing and re-serializing is safe here because npm
  // writes this file as `JSON.stringify(x, null, 2) + "\n"` itself.
  const lockPath = `${root}/package-lock.json`;
  if (existsSync(lockPath)) {
    const before = readFileSync(lockPath, "utf8");
    const lock = JSON.parse(before);
    if (lock.version) lock.version = next;
    if (lock.packages?.[""]?.version) lock.packages[""].version = next;
    const after = `${JSON.stringify(lock, null, 2)}\n`;
    if (after !== before) {
      writeFileSync(lockPath, after);
      changed.push(lockPath);
    }
  }

  return { current, next, changed };
}

// Invoked by .githooks/pre-commit as `node scripts/bumpVersion.mjs --write`.
if (process.argv.includes("--write")) {
  const { current, next } = bumpAll(".");
  console.log(`version ${current} -> ${next}`);
}
