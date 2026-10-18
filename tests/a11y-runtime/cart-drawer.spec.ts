import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags";

const HOST = "127.0.0.1";
const PORT = 3331;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_017;
const runId = `${Date.now()}-${process.pid}`;
const syncedAt = new Date("2026-10-18T05:00:00.000Z");

const slug = `cart-drawer-${runId}`;
const name = `Drawer Coat ${runId}`;
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
      pancakeProductId: `cart-drawer-${runId}`,
      slug,
      name,
      primaryImageUrl: "https://content.pancake.vn/images/8/8/8/drawer.jpg",
      isPresent: true,
      isActive: true,
      syncedAt,
      content: { create: { editorialDescription: "Cart drawer test coat." } },
    },
  });
  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `cart-drawer-var-${runId}`,
      productId: product.id,
      color: "Olive",
      size: "L",
      pancakeImageUrls: ["https://content.pancake.vn/images/8/8/8/drawer.jpg"],
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 1_250_000,
      pancakeRetailPriceAfterDiscount: 1_250_000,
      syncedAt,
    },
  });
  await prisma.warehouseStock.create({
    data: { variantId: variant.id, pancakeWarehouseId: `wh-drawer-${runId}`, quantity: 5, syncedAt },
  });

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      PANCAKE_SHOP_ID: String(SHOP_ID),
      BETTER_AUTH_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
      CART_DRAWER_ENABLED: "true",
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

const cartLink = (page: Page) => page.getByRole("navigation", { name: "Tiện ích" }).getByRole("link", { name: "Giỏ hàng" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Giỏ hàng" });

async function scanBuyerAxe(page: Page) {
  const scan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(scan.violations).toEqual([]);
}

async function addToBag(page: Page) {
  await page.goto(`${BASE_URL}/shop/${slug}`, { waitUntil: "networkidle" });
  await page.locator("label", { has: page.getByRole("radio", { name: "Olive", exact: true }) }).click();
  await page.locator("label", { has: page.getByRole("radio", { name: "L", exact: true }) }).click();
  await page.getByRole("button", { name: "Thêm vào giỏ hàng" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã thêm sản phẩm vào giỏ hàng." })).toBeVisible();
}

test("the server HTML has a plain link to /cart and no dialog", async ({ request }) => {
  const html = await (await request.get(`${BASE_URL}/shop`)).text();
  expect(html).toMatch(/<a[^>]*href="\/cart"[^>]*>Giỏ hàng<\/a>/);
  expect(html).not.toContain('role="dialog"');
});

test("an empty cart opens the drawer onto its dialog, Escape closes it and returns focus to the link", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop`, { waitUntil: "networkidle" });
  await cartLink(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toBeFocused();
  await expect(dialog(page).getByText("Giỏ hàng của bạn đang trống.")).toBeVisible();
  await scanBuyerAxe(page);

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(cartLink(page)).toBeFocused();
  // The page is scrollable again.
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("a cart with a line shows the cart page's own figures and traps Tab inside the dialog", async ({ page }) => {
  await addToBag(page);
  await cartLink(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("list", { name: "Sản phẩm trong giỏ hàng" })).toContainText(name);
  await expect(dialog(page)).toContainText("Số lượng: 1");

  const subtotalDigits = (await dialog(page).locator("p", { hasText: "Tạm tính" }).innerText()).match(/\d[\d.]*/)?.[0];
  expect(subtotalDigits).toBe("1.250.000");
  // The cart page states the same figure: the drawer passes the route's number through.
  const cartHtml = await (await page.request.get(`${BASE_URL}/cart`)).text();
  expect(cartHtml).toContain(subtotalDigits);
  await scanBuyerAxe(page);

  // Tab never leaves the dialog, forwards or backwards, however many presses.
  const inside = () => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
  await dialog(page).focus();
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
  }
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await inside()).toBe(true);
  }
});

test("closing restores focus; following a link inside closes the drawer", async ({ page }) => {
  await addToBag(page);
  await cartLink(page).click();
  await dialog(page).getByRole("button", { name: /Đóng/ }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(cartLink(page)).toBeFocused();

  await cartLink(page).click();
  await dialog(page).getByRole("link", { name: "Xem giỏ hàng" }).click();
  await page.waitForURL((url) => url.pathname === "/cart");
  await expect(dialog(page)).toHaveCount(0);
});

test("two activations in the same tick cost one server read, and the drawer still fills", async ({ page }) => {
  await addToBag(page);
  let reads = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) reads += 1;
    await route.fallback();
  });

  // Both clicks are dispatched before React can re-render, as with a held Enter or a double tap.
  await cartLink(page).evaluate((element) => {
    (element as HTMLAnchorElement).click();
    (element as HTMLAnchorElement).click();
  });
  await expect(dialog(page).getByRole("list", { name: "Sản phẩm trong giỏ hàng" })).toContainText(name);
  await page.waitForTimeout(500);
  expect(reads).toBe(1);

  // After closing, opening again is a new read, not blocked by the old guard.
  await dialog(page).getByRole("button", { name: /Đóng/ }).click();
  await expect(dialog(page)).toHaveCount(0);
  await cartLink(page).click();
  await expect(dialog(page).getByRole("list", { name: "Sản phẩm trong giỏ hàng" })).toContainText(name);
  expect(reads).toBe(2);
});

test("a modified click keeps the link a link and does not open the drawer", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop`, { waitUntil: "networkidle" });
  const [popup] = await Promise.all([
    page.context().waitForEvent("page"),
    cartLink(page).click({ modifiers: ["Control"] }),
  ]);
  await popup.close();
  await expect(dialog(page)).toHaveCount(0);
});

test("390x844 and 1440x900: the drawer fits, is axe clean and does not overflow", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE_URL}/shop`, { waitUntil: "networkidle" });
    await cartLink(page).click();
    await expect(dialog(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await scanBuyerAxe(page);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  }
});
