import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags";

const HOST = "127.0.0.1";
const PORT = 3312;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_014;
const runId = `${Date.now()}-${process.pid}`;
const syncedAt = new Date("2026-08-13T02:00:00.000Z");

let server: ChildProcess | undefined;
let serverOutput = "";

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js PLP filter server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/shop`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for PLP filter server\n${serverOutput}`);
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
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: SHOP_ID } });
  await prisma.collectionDefinition.deleteMany({
    where: { slug: { in: ["city-uniform", "essentials"] } },
  });
}

async function seedProduct(input: {
  key: string;
  name: string;
  collection: string;
  color: string;
  size: string;
  price: number;
  stock: number;
}) {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: `plpfilter-${input.key}-${runId}`,
      slug: `plpfilter-${input.key}-${runId}`,
      name: input.name,
      isPresent: true,
      isActive: true,
      syncedAt,
      content: {
        create: {
          editorialDescription: `Editorial ${input.key}`,
          collectionSlugs: [input.collection],
        },
      },
    },
  });
  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `plpfilter-${input.key}-variant-${runId}`,
      productId: product.id,
      color: input.color,
      size: input.size,
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: input.price,
      pancakeRetailPriceAfterDiscount: input.price,
      syncedAt,
    },
  });
  if (input.stock > 0) {
    await prisma.warehouseStock.create({
      data: {
        variantId: variant.id,
        pancakeWarehouseId: `plpfilter-${input.key}-warehouse-${runId}`,
        quantity: input.stock,
        syncedAt,
      },
    });
  }
}

test.beforeAll(async () => {
  await cleanup();
  await prisma.collectionDefinition.upsert({
    where: { slug: "city-uniform" },
    create: {
      slug: "city-uniform",
      title: "City Uniform",
      description: "City uniform collection.",
      seoTitle: "City Uniform",
      seoDescription: "City uniform",
      isPublished: true,
      pancakeCategoryIds: [],
    },
    update: { isPublished: true, title: "City Uniform" },
  });
  await seedProduct({
    key: "coat",
    name: `Filter City Coat ${runId}`,
    collection: "city-uniform",
    color: "Ink",
    size: "M",
    price: 1_200_000,
    stock: 2,
  });
  await seedProduct({
    key: "trouser",
    name: `Filter Stone Trouser ${runId}`,
    collection: "city-uniform",
    color: "Stone",
    size: "L",
    price: 700_000,
    stock: 3,
  });

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      PANCAKE_SHOP_ID: String(SHOP_ID),
      BETTER_AUTH_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
      SHOP_FILTER_DISCLOSURE_ENABLED: "true",
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

const trigger = (page: Page) => page.getByRole("button", { name: /^Bộ lọc/ });
const searchField = (page: Page) => page.getByLabel("Tìm sản phẩm");
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function scanBuyerAxe(page: Page) {
  const scan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(scan.violations).toEqual([]);
}

test("390x844: filters collapse behind a trigger, open to the first field, and axe is clean both ways", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop`, { waitUntil: "networkidle" });

  await expect(trigger(page)).toBeVisible();
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
  await expect(searchField(page)).toBeHidden();
  expect(await noOverflow(page)).toBe(true);
  await scanBuyerAxe(page);

  await trigger(page).click();
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
  await expect(searchField(page)).toBeVisible();
  await expect(searchField(page)).toBeFocused();
  expect(await noOverflow(page)).toBe(true);
  await scanBuyerAxe(page);
});

test("Escape closes the open panel and returns focus to the trigger", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop`, { waitUntil: "networkidle" });
  await trigger(page).click();
  await expect(searchField(page)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
  await expect(searchField(page)).toBeHidden();
  await expect(trigger(page)).toBeFocused();
});

test("applying a filter closes the panel, keeps URL state, labels the count and announces results", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop`, { waitUntil: "networkidle" });
  await expect(page.getByRole("status")).toContainText("Có 2 sản phẩm phù hợp.");

  await trigger(page).click();
  await page.getByLabel("Màu").selectOption("Ink");
  await page.getByRole("button", { name: "Áp dụng" }).click();
  await page.waitForURL((url) => url.searchParams.get("color") === "Ink");

  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
  await expect(trigger(page)).toBeFocused();
  await expect(trigger(page)).toHaveAccessibleName("Bộ lọc, 1 đang áp dụng");
  await expect(trigger(page)).toContainText("Bộ lọc (1)");
  await expect(page.getByRole("status")).toContainText("Có 1 sản phẩm phù hợp.");
  await expect(page.getByRole("heading", { level: 2, name: `Filter City Coat ${runId}` })).toBeVisible();
  await scanBuyerAxe(page);
});

test("removing a chip by keyboard keeps the other filters and moves focus to the next chip", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop?color=Ink&size=M&availability=in-stock`, { waitUntil: "networkidle" });
  const applied = page.getByRole("list", { name: "Bộ lọc đang áp dụng" });
  await expect(applied.getByRole("link")).toHaveCount(3);

  const removeColor = applied.getByRole("link", { name: "Bỏ lọc Màu: Ink" });
  await removeColor.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.searchParams.has("color"));

  const url = new URL(page.url());
  expect(url.searchParams.get("size")).toBe("M");
  expect(url.searchParams.get("availability")).toBe("in-stock");
  expect(url.searchParams.get("page")).toBeNull();
  await expect(applied.getByRole("link")).toHaveCount(2);
  // The chip that followed the removed one has focus, not the page body.
  await expect(applied.getByRole("link", { name: /^Bỏ lọc Kích cỡ/ })).toBeFocused();
});

test("removing the last chip lands focus on the trigger, not the body", async ({ page }) => {
  await page.goto(`${BASE_URL}/shop?color=Ink`, { waitUntil: "networkidle" });
  const applied = page.getByRole("list", { name: "Bộ lọc đang áp dụng" });
  await applied.getByRole("link", { name: "Bỏ lọc Màu: Ink" }).click();
  await page.waitForURL((url) => !url.searchParams.has("color"));
  await expect(applied).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
});

test("768px is still collapsed; 1440px shows the whole form with no trigger", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${BASE_URL}/shop`, { waitUntil: "networkidle" });
  await expect(trigger(page)).toBeVisible();
  await expect(searchField(page)).toBeHidden();
  expect(await noOverflow(page)).toBe(true);
  await scanBuyerAxe(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(trigger(page)).toBeHidden();
  await expect(searchField(page)).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await scanBuyerAxe(page);
});

test("the HTML a no-JavaScript client receives has an open form and no dead trigger", async ({ request }) => {
  // Asserted on the server's HTML rather than a JS-disabled browser: /shop streams behind its
  // loading boundary, which needs a script to reveal it, so a JS-disabled page is not visible with
  // or without this feature. What this feature controls is what is in the markup.
  const html = await (await request.get(`${BASE_URL}/shop`)).text();

  expect(html).toContain('name="q"');
  expect(html).toContain('name="color"');
  // The collapse button only exists once the client has measured the viewport.
  expect(html).not.toMatch(/<button[^>]*aria-expanded/);
  // The panel wrapper is not hidden in the initial markup.
  const panelId = html.match(/<div id="(_R_[^"]+)"/)?.[1];
  expect(panelId).toBeTruthy();
  expect(html).not.toMatch(new RegExp(`<div[^>]*hidden[^>]*id="${panelId}"`));
  expect(html).not.toMatch(new RegExp(`<div[^>]*id="${panelId}"[^>]*hidden`));

  // The GET form's own query still filters on the server.
  const filtered = await (await request.get(`${BASE_URL}/shop?color=Ink`)).text();
  expect(filtered).toContain(`Filter City Coat ${runId}`);
  expect(filtered).not.toContain(`Filter Stone Trouser ${runId}`);
});
