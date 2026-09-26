import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags";

const HOST = "127.0.0.1";
const PORT = 3324;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_016;
const suffix = `${Date.now()}-${process.pid}`;
const collectionSlug = `u4-related-${suffix}`;
const currentSlug = `u4-current-${suffix}`;
const soloSlug = `u4-solo-${suffix}`;
const currentName = `Current U4 Jacket ${suffix}`;
const draftCandidateName = `Alpha Draft Candidate ${suffix}`;
const publishedCandidateName = `Bravo Published Candidate ${suffix}`;
const hiddenCandidateName = `Hidden Candidate ${suffix}`;
const syncedAt = new Date("2026-08-26T00:00:00.000Z");

let server: ChildProcess | undefined;
let serverOutput = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`U4 server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/shop/${currentSlug}`, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for U4 server\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  const exited = await Promise.race([
    once(server, "exit").then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!exited) server.kill("SIGKILL");
}

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: SHOP_ID } });
  await prisma.collectionDefinition.deleteMany({ where: { slug: collectionSlug } });
}

async function seedProduct({
  key,
  slug,
  name,
  collectionSlugs = [],
  status = "PUBLISHED",
  isActive = true,
}: {
  key: string;
  slug: string;
  name: string;
  collectionSlugs?: string[];
  status?: "DRAFT" | "PUBLISHED";
  isActive?: boolean;
}) {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: `u4-${key}-${suffix}`,
      slug,
      name,
      isPresent: true,
      isActive,
      syncedAt,
      content: {
        create: {
          status,
          editorialDescription: status === "PUBLISHED" ? `Editorial ${key}` : null,
          collectionSlugs,
        },
      },
    },
  });
  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `u4-${key}-variant-${suffix}`,
      productId: product.id,
      color: "Ink",
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 900_000,
      pancakeRetailPriceAfterDiscount: 900_000,
      syncedAt,
    },
  });
  await prisma.warehouseStock.create({
    data: {
      variantId: variant.id,
      pancakeWarehouseId: `u4-${key}-warehouse-${suffix}`,
      quantity: 2,
      syncedAt,
    },
  });
}

test.beforeAll(async () => {
  await cleanup();
  await prisma.collectionDefinition.create({
    data: {
      slug: collectionSlug,
      title: "U4 Published Collection",
      description: "Published collection for deterministic related products.",
      isPublished: true,
    },
  });
  await seedProduct({ key: "current", slug: currentSlug, name: currentName, collectionSlugs: [collectionSlug] });
  await seedProduct({ key: "draft", slug: `u4-draft-${suffix}`, name: draftCandidateName, collectionSlugs: [collectionSlug], status: "DRAFT" });
  await seedProduct({ key: "published", slug: `u4-published-${suffix}`, name: publishedCandidateName, collectionSlugs: [collectionSlug] });
  await seedProduct({ key: "hidden", slug: `u4-hidden-${suffix}`, name: hiddenCandidateName, collectionSlugs: [collectionSlug], isActive: false });
  await seedProduct({ key: "solo", slug: soloSlug, name: `Solo Product ${suffix}` });

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      APP_DOMAIN: `${HOST}:${PORT}`,
      PANCAKE_SHOP_ID: String(SHOP_ID),
      BETTER_AUTH_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", captureServerOutput);
  server.stderr?.on("data", captureServerOutput);
  await waitForServer();
});

test.afterAll(async () => {
  await stopServer();
  await cleanup();
  await prisma.$disconnect();
});

test("U4 PDP renders deterministic visible related products from projected published membership", async ({ page }) => {
  const response = await page.goto(`${BASE_URL}/shop/${currentSlug}`, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);

  const related = page.getByRole("region", { name: "Hoàn thiện phối đồ" });
  await expect(related).toBeVisible();
  const names = await related.locator("article h2").allTextContents();
  expect(names).toEqual([draftCandidateName, publishedCandidateName]);
  await expect(related.getByText(currentName, { exact: true })).toHaveCount(0);
  await expect(related.getByText(hiddenCandidateName, { exact: true })).toHaveCount(0);
  await expect(related.locator('a[href="/size-guide"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const accessibilityScan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("U4 PDP omits the related-products region when projected membership has no candidates", async ({ page }) => {
  const response = await page.goto(`${BASE_URL}/shop/${soloSlug}`, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("region", { name: "Hoàn thiện phối đồ" })).toHaveCount(0);
});
