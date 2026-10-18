import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { BUYER_AXE_TAGS } from "../a11y-runtime/axe-tags.ts";

const A11Y_DIRECTORY = fileURLToPath(new URL("../a11y-runtime/", import.meta.url));
const ADMIN_ONLY_AXE_SPECS = new Set([
  "admin-collections.spec.ts",
  "admin-editor.spec.ts",
  "admin-new-arrivals.spec.ts",
]);

async function listAxeSpecs(): Promise<Array<{ name: string; source: string }>> {
  const entries = await readdir(A11Y_DIRECTORY, { withFileTypes: true });
  const specs: Array<{ name: string; source: string }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".spec.ts")) continue;
    const path = join(A11Y_DIRECTORY, entry.name);
    const source = await readFile(path, "utf8");
    if (!source.includes("AxeBuilder")) continue;
    specs.push({ name: basename(path), source });
  }

  return specs.sort((left, right) => left.name.localeCompare(right.name));
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

test("buyer Axe tag set keeps WCAG coverage and opts into best-practice landmarks", () => {
  assert.deepEqual(BUYER_AXE_TAGS, [
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "best-practice",
  ]);
});

test("every buyer Axe scan uses the shared best-practice tag set", async () => {
  const axeSpecs = await listAxeSpecs();
  const adminSpecs = axeSpecs
    .filter((spec) => ADMIN_ONLY_AXE_SPECS.has(spec.name))
    .map((spec) => spec.name);

  assert.deepEqual(
    adminSpecs,
    [...ADMIN_ONLY_AXE_SPECS].sort(),
    "Admin-only Axe allowlist must match the existing admin specs",
  );

  const buyerSpecs = axeSpecs.filter((spec) => !ADMIN_ONLY_AXE_SPECS.has(spec.name));
  const offenders: string[] = [];

  for (const { name, source } of buyerSpecs) {
    const builderCount = countMatches(source, /new\s+AxeBuilder\s*\(/g);
    const withTagsCount = countMatches(source, /\.withTags\s*\(/g);
    const sharedTagsCount = countMatches(
      source,
      /\.withTags\s*\(\s*BUYER_AXE_TAGS\s*\)/g,
    );

    if (
      builderCount === 0 ||
      withTagsCount !== builderCount ||
      sharedTagsCount !== builderCount
    ) {
      offenders.push(
        `${name} (builders=${builderCount}, withTags=${withTagsCount}, shared=${sharedTagsCount})`,
      );
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Buyer-facing AxeBuilder scans must use BUYER_AXE_TAGS: ${offenders.join(", ")}`,
  );
});
