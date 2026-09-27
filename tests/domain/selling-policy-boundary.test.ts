import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * One reader (spec: docs/specs/core-kit-selling-modes-v1.md §4.2). If any other module read
 * `ProductSellingPolicy` directly, it would have to re-derive the missing-row default and the flag
 * gates, and the two answers would drift. Everything else receives stored rows from the repository
 * and interprets them through `effectivePolicy()`.
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO_ROOT, "src");
const ALLOWED = new Set(["src/commerce/selling-policy-repository.ts"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test("only the selling-policy repository reads ProductSellingPolicy", () => {
  const offenders = sourceFiles(SRC)
    .map((file) => path.relative(REPO_ROOT, file).split(path.sep).join("/"))
    .filter((file) => !ALLOWED.has(file))
    .filter((file) => /productSellingPolicy\b|"ProductSellingPolicy"/.test(readFileSync(path.join(REPO_ROOT, file), "utf8")));
  assert.deepEqual(offenders, []);
});
