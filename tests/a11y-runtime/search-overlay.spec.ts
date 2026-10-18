import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags";

const HOST = "127.0.0.1";
const PORT = 3332;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_020;
const runId = `${Date.now()}-${process.pid}`;
const syncedAt = new Date("2026-10-18T06:00:00.000Z");

const WORD = "overlay";
const TOTAL = 8;
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


async function seed(key: string, name: string, options: { isActive?: boolean } = {}) {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: `${WORD}-${key}-${runId}`,
      slug: `${WORD}-${key}-${runId}`,
      name,
      primaryImageUrl: "https://content.pancake.vn/images/7/7/7/overlay.jpg",
      isPresent: true,
      isActive: options.isActive ?? true,
      syncedAt,
      content: { create: { editorialDescription: "Search overlay test product." } },
    },
  });
  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `${WORD}-var-${key}-${runId}`,
      productId: product.id,
      color: "Ink",
      size: "M",
      pancakeImageUrls: ["https://content.pancake.vn/images/7/7/7/overlay.jpg"],
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 900_000,
      pancakeRetailPriceAfterDiscount: 900_000,
      syncedAt,
    },
  });
  await prisma.warehouseStock.create({
    data: { variantId: variant.id, pancakeWarehouseId: `wh-${key}-${runId}`, quantity: 4, syncedAt },
  });
}

test.beforeAll(async () => {
  await cleanup();
  for (let index = 0; index < TOTAL; index += 1) {
    await seed(`c${index}`, `Overlay Coat ${String(index).padStart(2, "0")}`);
  }
  await seed("hidden", "Overlay Hidden Coat", { isActive: false });
  await seed("other", "Plain Shirt");

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      PANCAKE_SHOP_ID: String(SHOP_ID),
      BETTER_AUTH_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
      SEARCH_SUGGESTIONS_ENABLED: "true",
      SEARCH_OVERLAY_ENABLED: "true",
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

/**
 * The header's search link where a shopper can actually see it: the utility bar on a wide viewport,
 * the Menu disclosure below 1024px (the utility bar hides every link but the last on narrow ones).
 */
const searchLink = (page: Page) => {
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  return page
    .getByRole("navigation", { name: wide ? "Tiện ích" : "Điều hướng chính trên di động" })
    .getByRole("link", { name: "Tìm kiếm" });
};
const revealSearchLink = async (page: Page) => {
  if ((page.viewportSize()?.width ?? 0) < 1024) await page.getByText("Menu", { exact: true }).click();
};
const dialog = (page: Page) => page.getByRole("dialog", { name: "Tìm kiếm" });
const field = (page: Page) => dialog(page).getByRole("searchbox", { name: "Tìm sản phẩm" });
const suggestions = (page: Page) => dialog(page).getByRole("list", { name: "Gợi ý sản phẩm" });

async function scanBuyerAxe(page: Page) {
  const scan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(scan.violations).toEqual([]);
}

async function open(page: Page) {
  await page.goto(`${BASE_URL}/shop`, { waitUntil: "networkidle" });
  await revealSearchLink(page);
  await searchLink(page).click();
  await expect(dialog(page)).toBeVisible();
}

test("the server HTML has a plain link to /search and no dialog", async ({ request }) => {
  const html = await (await request.get(`${BASE_URL}/shop`)).text();
  expect(html).toMatch(/<a[^>]*href="\/search"[^>]*>Tìm kiếm<\/a>/);
  expect(html).not.toContain('role="dialog"');
});

test("opening focuses the field with a hint and no list; axe is clean", async ({ page }) => {
  await open(page);
  await expect(field(page)).toBeFocused();
  await expect(dialog(page).getByText("Nhập ít nhất 2 ký tự để xem gợi ý.")).toBeVisible();
  await expect(suggestions(page)).toHaveCount(0);
  await scanBuyerAxe(page);
});

test("typing shows the bounded canonical suggestions, the true total and a see-all link; hidden products never appear", async ({ page }) => {
  await open(page);
  await field(page).fill(WORD);
  await expect(suggestions(page).getByRole("listitem")).toHaveCount(6);
  await expect(dialog(page).getByRole("status")).toHaveText(`Có ${TOTAL} sản phẩm phù hợp.`);
  await expect(suggestions(page)).not.toContainText("Hidden");
  await expect(suggestions(page).getByRole("link").first()).toContainText("Overlay Coat 00");
  await expect(dialog(page).getByRole("link", { name: `Xem tất cả ${TOTAL} sản phẩm` })).toHaveAttribute("href", `/shop?q=${WORD}`);
  await scanBuyerAxe(page);
});

test("a slow answer for older text never replaces the answer for what is in the box now", async ({ page }) => {
  let delayed = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"] && !delayed) {
      delayed = true;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    await route.fallback();
  });
  await open(page);
  await field(page).fill(WORD);
  await page.waitForTimeout(350); // past the debounce: request 1 (8 matches) is in flight and slow
  await field(page).fill("overlay coat 03");
  await expect(dialog(page).getByRole("status")).toHaveText("Có 1 sản phẩm phù hợp.");
  await page.waitForTimeout(2_500); // the slow answer has now arrived
  await expect(dialog(page).getByRole("status")).toHaveText("Có 1 sản phẩm phù hợp.");
  await expect(suggestions(page).getByRole("listitem")).toHaveCount(1);
});

test("no matches says so; the form still submits to /shop", async ({ page }) => {
  await open(page);
  await field(page).fill("qqqzzz");
  await expect(dialog(page).getByRole("status")).toHaveText("Không có sản phẩm phù hợp.");
  await field(page).press("Enter");
  await page.waitForURL((url) => url.pathname === "/shop" && url.searchParams.get("q") === "qqqzzz");
});

test("arrow keys move between the field and the suggestions; Escape closes and returns focus", async ({ page }) => {
  await open(page);
  await field(page).fill(WORD);
  await expect(suggestions(page).getByRole("listitem")).toHaveCount(6);

  await page.keyboard.press("ArrowDown");
  await expect(suggestions(page).getByRole("link").nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(suggestions(page).getByRole("link").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(field(page)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(searchLink(page)).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("choosing a suggestion goes to its canonical PDP and closes the overlay", async ({ page }) => {
  await open(page);
  await field(page).fill("overlay coat 03");
  await suggestions(page).getByRole("link").first().click();
  await page.waitForURL((url) => url.pathname === `/shop/${WORD}-c3-${runId}`);
  await expect(dialog(page)).toHaveCount(0);
});

test("Tab and Shift+Tab never leave the dialog", async ({ page }) => {
  await open(page);
  await field(page).fill(WORD);
  await expect(suggestions(page).getByRole("listitem")).toHaveCount(6);
  const inside = () => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
  }
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await inside()).toBe(true);
  }
});

test("a modified click keeps the link a link and does not open the overlay", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop`, { waitUntil: "networkidle" });
  await revealSearchLink(page);
  const [popup] = await Promise.all([
    page.context().waitForEvent("page"),
    searchLink(page).click({ modifiers: ["Control"] }),
  ]);
  await popup.close();
  await expect(dialog(page)).toHaveCount(0);
});

test("390x844 and 1440x900 with results: no overflow and axe clean", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await open(page);
    await field(page).fill(WORD);
    await expect(suggestions(page).getByRole("listitem")).toHaveCount(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await scanBuyerAxe(page);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  }
});
