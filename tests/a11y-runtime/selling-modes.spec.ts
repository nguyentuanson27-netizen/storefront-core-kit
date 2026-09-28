import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { BRAND } from "../../src/brand/index.ts";
import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags";

/**
 * Selling modes spec §12 "Browser" (M3): with both flags on in this server only, an OVERSELL
 * variant below zero sells with no marker, a PREORDER preorder-sale variant carries the brand
 * marker on the card, PDP and cart, and `availability=in-stock` means "buyable now without preorder".
 */

const HOST = "127.0.0.1";
const PORT = 3331;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_031;
const runId = `${Date.now()}-${process.pid}`;
const syncedAt = new Date("2026-09-01T00:00:00.000Z");
const MARKER = BRAND.copy.preorderLabel;

const oversell = { name: `Oversell Tee ${runId}`, slug: `selling-modes-oversell-${runId}` };
const preorder = { name: `Preorder Tee ${runId}`, slug: `selling-modes-preorder-${runId}` };

let server: ChildProcess | undefined;
let serverOutput = "";

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js selling-modes server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/shop/${oversell.slug}`, { redirect: "manual" });
      if (response.status === 200 && (await response.text()).includes(oversell.name)) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for the selling-modes server\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  const exited = await Promise.race([once(server, "exit").then(() => true), delay(5_000).then(() => false)]);
  if (!exited) server.kill("SIGKILL");
  server = undefined;
}

async function cleanup() {
  await prisma.cartItem.deleteMany({ where: { variant: { product: { pancakeShopId: SHOP_ID } } } });
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: SHOP_ID } });
}

async function product(
  fixture: { name: string; slug: string },
  stock: number,
  sellingMode: "OVERSELL" | "PREORDER",
) {
  const created = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: fixture.slug,
      slug: fixture.slug,
      name: fixture.name,
      isPresent: true,
      isActive: true,
      syncedAt,
      content: { create: { status: "PUBLISHED", editorialDescription: `${fixture.name} description.` } },
      sellingPolicy: { create: { sellingMode, negativeStockLimit: -20 } },
    },
  });
  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `${fixture.slug}-m`,
      productId: created.id,
      color: "Black",
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 450_000,
      pancakeRetailPriceAfterDiscount: 450_000,
      syncedAt,
    },
  });
  await prisma.warehouseStock.create({
    data: { variantId: variant.id, pancakeWarehouseId: `${fixture.slug}-w`, quantity: stock, syncedAt },
  });
}

async function assertAccessible(page: Page) {
  const scan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(scan.violations).toEqual([]);
}

function card(page: Page, name: string) {
  return page.locator("article", { has: page.getByRole("link", { name: `Xem ${name}` }) });
}

async function addToBag(page: Page, slug: string) {
  await page.goto(`${BASE_URL}/shop/${slug}`, { waitUntil: "networkidle" });
  await page.getByText("Black", { exact: true }).click();
  await page.getByText("M", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Thêm vào giỏ hàng" })).toBeEnabled();
}

test.beforeAll(async () => {
  await cleanup();
  await product(oversell, -3, "OVERSELL");
  await product(preorder, 0, "PREORDER");

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      APP_DOMAIN: `${HOST}:${PORT}`,
      PANCAKE_SHOP_ID: String(SHOP_ID),
      BETTER_AUTH_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
      // In this test server only. Production keeps both off until M3 ships (spec §13).
      SELLING_MODES_ENABLED: "true",
      SELLING_MODE_PREORDER_ENABLED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk: Buffer) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
  });
  await waitForServer();
});

test.afterAll(async () => {
  await stopServer();
  await cleanup();
  await prisma.$disconnect();
});

test("an OVERSELL variant at −3 is purchasable with no marker anywhere", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop`, { waitUntil: "networkidle" });
  await expect(card(page, oversell.name)).toBeVisible();
  await expect(card(page, oversell.name).locator("[data-preorder-marker]")).toHaveCount(0);

  await addToBag(page, oversell.slug);
  await expect(page.getByRole("status")).not.toContainText(MARKER);
  await page.getByRole("button", { name: "Thêm vào giỏ hàng" }).click();
  await expect(page.getByRole("status")).toContainText("Đã thêm sản phẩm vào giỏ hàng.");

  await page.goto(`${BASE_URL}/cart`, { waitUntil: "networkidle" });
  const line = page.getByRole("article").filter({ hasText: oversell.name });
  await expect(line.getByText("Có thể mua")).toBeVisible();
  await expect(line.locator("[data-preorder-marker]")).toHaveCount(0);
  await assertAccessible(page);
});

test("a PREORDER preorder-sale variant carries the brand marker on the card, PDP and cart", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop`, { waitUntil: "networkidle" });
  await expect(card(page, preorder.name).locator("[data-preorder-marker]")).toHaveText(MARKER);
  await assertAccessible(page);

  await addToBag(page, preorder.slug);
  await expect(page.getByRole("status")).toHaveText(MARKER);
  await assertAccessible(page);
  await page.getByRole("button", { name: "Thêm vào giỏ hàng" }).click();
  await expect(page.getByRole("status")).toContainText("Đã thêm sản phẩm vào giỏ hàng.");

  await page.goto(`${BASE_URL}/cart`, { waitUntil: "networkidle" });
  const line = page.getByRole("article").filter({ hasText: preorder.name });
  await expect(line.locator("[data-preorder-marker]")).toHaveText(MARKER);
  await assertAccessible(page);
});

test("availability=in-stock keeps the OVERSELL variant and excludes the preorder sale", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop?availability=in-stock`, { waitUntil: "networkidle" });
  await expect(card(page, oversell.name)).toBeVisible();
  await expect(card(page, preorder.name)).toHaveCount(0);
});
