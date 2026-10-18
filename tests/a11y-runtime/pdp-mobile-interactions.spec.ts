import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { BRAND } from "../../src/brand/index.ts";
import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags";

const HOST = "127.0.0.1";
const PORT = 3330;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_015;
const runId = `${Date.now()}-${process.pid}`;
const syncedAt = new Date("2026-10-18T04:00:00.000Z");

const preorderSlug = `pdp-mobile-preorder-${runId}`;
const slug = `pdp-mobile-${runId}`;
const name = `Mobile Parka ${runId}`;
const IMAGES = [1, 2, 3].map((n) => `https://content.pancake.vn/images/9/9/9/pdp-mobile-${n}.jpg`);
// 1x1 transparent/dummy JPEG image payload for offline-safe fixture responses
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const TINY_JPEG_BUFFER = Buffer.from(TINY_JPEG_BASE64, "base64");

let server: ChildProcess | undefined;
let serverOutput = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js media test server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/shop`, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for storefront media server\n${serverOutput}`);
}

async function waitForServerExit(timeoutMs: number) {
  if (!server || server.exitCode !== null) return true;
  return Promise.race([
    once(server, "exit").then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

async function stopServer() {
  if (!server || server.exitCode !== null) {
    server = undefined;
    return;
  }
  server.kill("SIGTERM");
  if (!(await waitForServerExit(5_000))) {
    server.kill("SIGKILL");
    await waitForServerExit(5_000);
  }
  server = undefined;
}

async function cleanup() {
  await prisma.cartItem.deleteMany({
    where: { variant: { product: { pancakeShopId: SHOP_ID } } },
  });
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: SHOP_ID } });
}


test.beforeAll(async () => {
  await cleanup();
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: `pdp-mobile-${runId}`,
      slug,
      name,
      primaryImageUrl: IMAGES[0],
      isPresent: true,
      isActive: true,
      syncedAt,
      content: { create: { editorialDescription: "Mobile interaction test parka." } },
    },
  });
  const make = async (key: string, color: string, size: string, images: string[], stock: number) => {
    const variant = await prisma.variantMirror.create({
      data: {
        pancakeVariationId: `pdp-mobile-${key}-${runId}`,
        productId: product.id,
        color,
        size,
        pancakeImageUrls: images,
        isPresent: true,
        isActive: true,
        pancakeRetailPrice: 1_250_000,
        pancakeRetailPriceAfterDiscount: 1_250_000,
        syncedAt,
      },
    });
    if (stock > 0) {
      await prisma.warehouseStock.create({
        data: { variantId: variant.id, pancakeWarehouseId: `wh-${key}-${runId}`, quantity: stock, syncedAt },
      });
    }
  };
  await make("black-m", "Black", "M", [IMAGES[0]!, IMAGES[1]!], 5);
  await make("olive-l", "Olive", "L", [IMAGES[2]!], 3);
  await make("black-l", "Black", "L", [IMAGES[0]!], 0);

  // A PREORDER product with nothing ready: its only option sells as a preorder.
  const preorderProduct = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: `pdp-mobile-preorder-${runId}`,
      slug: preorderSlug,
      name: `Mobile Preorder ${runId}`,
      primaryImageUrl: IMAGES[0],
      isPresent: true,
      isActive: true,
      syncedAt,
      content: { create: { status: "PUBLISHED", editorialDescription: "Preorder test." } },
      sellingPolicy: { create: { sellingMode: "PREORDER", negativeStockLimit: -20 } },
    },
  });
  const preorderVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `pdp-mobile-preorder-var-${runId}`,
      productId: preorderProduct.id,
      color: "Black",
      size: "M",
      pancakeImageUrls: [IMAGES[0]!],
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 450_000,
      pancakeRetailPriceAfterDiscount: 450_000,
      syncedAt,
    },
  });
  await prisma.warehouseStock.create({
    data: { variantId: preorderVariant.id, pancakeWarehouseId: `wh-preorder-${runId}`, quantity: 0, syncedAt },
  });

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      PANCAKE_SHOP_ID: String(SHOP_ID),
      BETTER_AUTH_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
      PDP_MOBILE_INTERACTIONS_ENABLED: "true",
      // Test server only: the preorder case needs selling modes on. The other products have no policy, so they stay STANDARD.
      SELLING_MODES_ENABLED: "true",
      SELLING_MODE_PREORDER_ENABLED: "true",
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

test.beforeEach(async ({ page }) => {
  await page.route("**/_next/image**", (route) =>
    route.fulfill({ status: 200, contentType: "image/jpeg", body: TINY_JPEG_BUFFER }),
  );
});

const bar = (page: Page) => page.locator("[data-pdp-sticky-bar]");
const barButton = (page: Page) => bar(page).getByRole("button");
const region = (page: Page) => page.getByRole("region", { name: /Bộ sưu tập hình ảnh/ });
const position = (page: Page) => region(page).getByRole("status");

/** The radios are visually hidden; a shopper taps the label that draws them. */
async function choose(page: Page, option: string) {
  await page.locator("label", { has: page.getByRole("radio", { name: option, exact: true }) }).click();
}

async function open(page: Page) {
  await page.goto(`${BASE_URL}/shop/${slug}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

async function assertQuality(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(overflow).toBe(true);
  const scan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(scan.violations).toEqual([]);
}

test("the server HTML carries no sticky bar: it exists only after the client measures", async ({ request }) => {
  const html = await (await request.get(`${BASE_URL}/shop/${slug}`)).text();
  expect(html).not.toContain("data-pdp-sticky-bar");
  expect(html).toContain("Thêm vào giỏ hàng");
});

test("390x844: the bar asks for the missing choice, moves the shopper to it, then hides over the real panel", async ({ page }) => {
  await open(page);
  await expect(bar(page)).toBeVisible();
  await expect(barButton(page)).toHaveText("Chọn màu");
  await assertQuality(page);

  await barButton(page).click();
  await expect(page.getByRole("radio", { name: "Black" })).toBeFocused();
  // The real panel is now on screen, so the bar steps aside.
  await expect(bar(page)).toBeHidden();

  await choose(page, "Black");
  await choose(page, "M");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar(page)).toBeVisible();
  await expect(barButton(page)).toHaveText("Thêm vào giỏ hàng");
  await assertQuality(page);
});

test("adding from the bar uses the panel's own action and shows feedback", async ({ page }) => {
  await open(page);
  await choose(page, "Olive");
  await choose(page, "L");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(barButton(page)).toHaveText("Thêm vào giỏ hàng");

  await barButton(page).click();
  await expect(bar(page)).toContainText("Đã thêm sản phẩm vào giỏ hàng.");
  // Read aloud once, by the panel's live region; the bar's copy is not a second announcement.
  await expect(page.getByRole("status").filter({ hasText: "Đã thêm sản phẩm vào giỏ hàng." })).toHaveCount(1);
  await expect(bar(page).getByText("Đã thêm sản phẩm vào giỏ hàng.")).toHaveAttribute("aria-hidden", "true");
});

test("an out-of-stock combination cannot be chosen, so the bar keeps asking for a valid choice", async ({ page }) => {
  await open(page);
  await choose(page, "Black");
  // Black comes in M (stock) and L (none): the panel disables the unbuyable size rather than letting
  // the shopper select it, and the bar follows the panel instead of offering a dead end.
  await expect(page.getByRole("radio", { name: "L", exact: true })).toBeDisabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(barButton(page)).toHaveText("Chọn kích cỡ");
  await expect(barButton(page)).toBeEnabled();
});

test("a preorder option carries the brand's preorder marker in the bar, from the panel's own message", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop/${preorderSlug}`, { waitUntil: "networkidle" });
  await choose(page, "Black");
  await choose(page, "M");
  // The panel states it (its live region), and the bar must not be the one surface that does not.
  await expect(page.getByRole("status").filter({ hasText: BRAND.copy.preorderLabel }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator("[data-preorder-marker]")).toHaveText(BRAND.copy.preorderLabel);
  await expect(barButton(page)).toHaveText("Thêm vào giỏ hàng");
  await assertQuality(page);
});

test("a ready (non-preorder) option shows no preorder marker in the bar", async ({ page }) => {
  await open(page);
  await choose(page, "Olive");
  await choose(page, "L");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator("[data-preorder-marker]")).toHaveCount(0);
});

test("scrolling past the product detail hides the bar, so it never covers the footer, even for keyboard users", async ({ page }) => {
  await open(page);
  await expect(bar(page)).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(bar(page)).toBeHidden();

  // The last footer link is reachable and nothing is painted over it.
  const footerLinks = page.locator("footer a[href]");
  const last = footerLinks.last();
  await last.focus();
  await expect(last).toBeFocused();
  const covered = await last.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== element && !element.contains(hit);
  });
  expect(covered).toBe(false);
  await assertQuality(page);

  // Coming back up to the product, the bar returns.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar(page)).toBeVisible();
});

test("gallery: buttons, arrow keys, Home/End and a touch swipe move the frame without wrapping", async ({ page }) => {
  await open(page);
  await expect(position(page)).toHaveText("Ảnh 1 trên 3");
  await expect(region(page).getByRole("button", { name: "Ảnh trước" })).toBeDisabled();

  await region(page).getByRole("button", { name: "Ảnh sau" }).click();
  await expect(position(page)).toHaveText("Ảnh 2 trên 3");

  await region(page).focus();
  await page.keyboard.press("End");
  await expect(position(page)).toHaveText("Ảnh 3 trên 3");
  await expect(region(page).getByRole("button", { name: "Ảnh sau" })).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(position(page)).toHaveText("Ảnh 3 trên 3");
  await page.keyboard.press("ArrowLeft");
  await expect(position(page)).toHaveText("Ảnh 2 trên 3");
  await page.keyboard.press("Home");
  await expect(position(page)).toHaveText("Ảnh 1 trên 3");

  const swipe = async (fromX: number, toX: number, y = 300) => {
    await region(page).dispatchEvent("pointerdown", { pointerType: "touch", clientX: fromX, clientY: y, bubbles: true });
    await region(page).dispatchEvent("pointerup", { pointerType: "touch", clientX: toX, clientY: y + 4, bubbles: true });
  };
  await swipe(300, 120);
  await expect(position(page)).toHaveText("Ảnh 2 trên 3");
  await swipe(120, 300);
  await expect(position(page)).toHaveText("Ảnh 1 trên 3");
  // A vertical drag is the page scrolling, not a swipe.
  await region(page).dispatchEvent("pointerdown", { pointerType: "touch", clientX: 200, clientY: 100, bubbles: true });
  await region(page).dispatchEvent("pointerup", { pointerType: "touch", clientX: 190, clientY: 300, bubbles: true });
  await expect(position(page)).toHaveText("Ảnh 1 trên 3");
  await assertQuality(page);
});

test("768px keeps the bar; 1440px has none and a normal panel", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await open(page);
  await expect(bar(page)).toBeVisible();
  await assertQuality(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(bar(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Thêm vào giỏ hàng" })).toBeVisible();
  await assertQuality(page);
});
