import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags.ts";

/**
 * B03: the curated /new-arrivals listing, with the flag ON (port 3334) and OFF (port 3335).
 *
 * Each mode is a real dev server with its own environment, because the flag is a runtime value. The
 * catalog rows are real database rows, so card prices, links and visibility come from the same
 * projection the storefront uses.
 */

const HOST = "127.0.0.1";
const ON_PORT = 3334;
const OFF_PORT = 3335;
const ON_URL = `http://${HOST}:${ON_PORT}`;
const OFF_URL = `http://${HOST}:${OFF_PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_041;
const PREFIX = "na-curate";

type Running = { child: ChildProcess; output: () => string };
const servers: Running[] = [];

function startServer(port: number, enabled: boolean): Running {
  let output = "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PANCAKE_SHOP_ID: String(SHOP_ID),
    BETTER_AUTH_URL: `http://${HOST}:${port}`,
    APP_DOMAIN: `${HOST}:${port}`,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  if (enabled) env.NEW_ARRIVALS_CURATION_ENABLED = "true";
  else delete env.NEW_ARRIVALS_CURATION_ENABLED;
  const child = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(port)], {
    cwd: APP_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-20_000);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  const running = { child, output: () => output };
  servers.push(running);
  return running;
}

async function waitFor(url: string, server: Running) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.child.exitCode !== null) {
      throw new Error(`Next.js server exited with ${server.child.exitCode}\n${server.output()}`);
    }
    try {
      const response = await fetch(`${url}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // still compiling
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}\n${server.output()}`);
}

async function stop(server: Running) {
  if (server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  const exited = await Promise.race([once(server.child, "exit").then(() => true), delay(5_000).then(() => false)]);
  if (!exited) server.child.kill("SIGKILL");
}

async function cleanup() {
  await prisma.newArrivalsSelection.deleteMany();
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: PREFIX } } });
}

const ids: string[] = [];
const slugs: string[] = [];

async function seed(count: number) {
  for (let index = 0; index < count; index += 1) {
    const key = `${PREFIX}-${String(index).padStart(2, "0")}`;
    const created = await prisma.productMirror.create({
      data: {
        pancakeShopId: SHOP_ID,
        pancakeProductId: key,
        slug: key,
        name: `Mẫu ${String(index).padStart(2, "0")}`,
        syncedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await prisma.variantMirror.create({
      data: {
        id: key,
        pancakeVariationId: key,
        productId: created.id,
        pancakeRetailPrice: 250_000,
        pancakeRetailPriceAfterDiscount: 250_000,
        size: "M",
        syncedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await prisma.warehouseStock.create({
      data: { variantId: key, pancakeWarehouseId: "w0", quantity: 5, syncedAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    ids.push(created.id);
    slugs.push(key);
  }
}

async function select(indexes: number[]) {
  await prisma.newArrivalsSelection.deleteMany();
  await prisma.newArrivalsSelection.createMany({
    data: indexes.map((index, position) => ({ productId: ids[index]!, position })),
  });
}

/** Distinct product links the page renders, in document order. */
async function cardSlugs(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator(`a[href^="/shop/${PREFIX}-"]`)
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""));
  return [...new Set(hrefs.map((href) => href.replace("/shop/", "")))];
}

async function expectClean(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const scan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(scan.violations).toEqual([]);
}

test.beforeAll(async () => {
  await cleanup();
  await seed(26);
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/**
 * One Next dev server per project directory can run at a time, so the two modes run one after the
 * other: each describe starts its own server (flag ON, then flag OFF) and stops it before the next.
 */
function withServer(port: number, enabled: boolean) {
  let running: Running;
  test.beforeAll(async () => {
    running = startServer(port, enabled);
    await waitFor(`http://${HOST}:${port}`, running);
  });
  test.afterAll(async () => {
    await stop(running);
  });
}

test.describe("flag ON", () => {
  withServer(ON_PORT, true);

  test("ON: 26 stored slots paginate 24 + 2 in stored order, and a hidden product's hole is not refilled", async ({ page }) => {
    await select(Array.from({ length: 26 }, (_unused, index) => index));
    await prisma.productMirror.update({ where: { id: ids[3]! }, data: { isActive: false } });

    const response = await page.goto(`${ON_URL}/new-arrivals`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Hàng mới/);
    await expect(page.getByRole("heading", { level: 1, name: "HÀNG MỚI" })).toBeVisible();

    const first = await cardSlugs(page);
    const expectedFirst = slugs.slice(0, 24).filter((_slug, index) => index !== 3);
    expect(first).toEqual(expectedFirst);
    expect(first).not.toContain(slugs[24]);
    expect(first).toHaveLength(23);
    await expect(page.getByText("Trang 1/2")).toBeVisible();

    // Keyboard: reach "Trang sau" by Tab and follow it with Enter.
    const next = page.getByRole("link", { name: /Trang sau/ });
    await next.focus();
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.pathname === "/new-arrivals" && url.searchParams.get("page") === "2");
    await expect(page).toHaveTitle(/Hàng mới — Trang 2/);
    expect(await cardSlugs(page)).toEqual([slugs[24], slugs[25]]);
    await expect(page.getByRole("link", { name: /Trang trước/ })).toHaveAttribute("href", "/new-arrivals");
  });

  test("ON: responsive and accessible at 390x844, 768x1024 and 1440x900", async ({ page }) => {
    await select(Array.from({ length: 26 }, (_unused, index) => index));
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      for (const path of ["/new-arrivals", "/new-arrivals?page=2"]) {
        await page.goto(`${ON_URL}${path}`, { waitUntil: "networkidle" });
        await expect(page.getByRole("heading", { level: 1, name: "HÀNG MỚI" })).toBeVisible();
        await expectClean(page);
      }
    }
  });

  test("ON: invalid and out-of-range pages are 404, not redirects or unbounded reads", async ({ request }) => {
    await select(Array.from({ length: 26 }, (_unused, index) => index));
    for (const query of ["?page=3", "?page=0", "?page=-1", "?page=abc", "?page=01", "?page=2&page=2", "?page=22", "?page=99999999999999999999"]) {
      const response = await request.get(`${ON_URL}/new-arrivals${query}`, { maxRedirects: 0 });
      expect(response.status(), query).toBe(404);
    }
    for (const query of ["", "?page=1", "?page=2", "?page=", "?unrelated=1"]) {
      const response = await request.get(`${ON_URL}/new-arrivals${query}`, { maxRedirects: 0 });
      expect(response.status(), query).toBe(200);
    }
  });

  test("ON + empty selection: editorial frame, an accessible status, zero cards, no redirect", async ({ page }) => {
    await select([]);
    const response = await page.goto(`${ON_URL}/new-arrivals`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/new-arrivals");
    await expect(page.getByRole("heading", { level: 1, name: "HÀNG MỚI" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Chưa có sản phẩm mới để hiển thị." })).toBeVisible();
    expect(await cardSlugs(page)).toEqual([]);
    await expectClean(page);

    const second = await page.request.get(`${ON_URL}/new-arrivals?page=2`, { maxRedirects: 0 });
    expect(second.status()).toBe(404);
  });

  test("ON: a page whose stored slots are all hidden keeps the frame and the way back", async ({ page }) => {
    await select(Array.from({ length: 25 }, (_unused, index) => index));
    await prisma.productMirror.update({ where: { id: ids[3]! }, data: { isActive: true } });
    await prisma.productMirror.update({ where: { id: ids[24]! }, data: { isActive: false } });

    const response = await page.goto(`${ON_URL}/new-arrivals?page=2`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("status").filter({ hasText: "Chưa có sản phẩm mới để hiển thị." })).toBeVisible();
    expect(await cardSlugs(page)).toEqual([]);
    await expectClean(page);

    await prisma.productMirror.update({ where: { id: ids[24]! }, data: { isActive: true } });
  });
});

test.describe("flag OFF (default)", () => {
  withServer(OFF_PORT, false);

  test("OFF (default): the editorial page only — no list, no query handling, no curated read", async ({ page, request }) => {
    await select(Array.from({ length: 26 }, (_unused, index) => index));

    const response = await page.goto(`${OFF_URL}/new-arrivals`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Hàng mới/);
    await expect(page.getByRole("heading", { level: 1, name: "HÀNG MỚI" })).toBeVisible();
    expect(await cardSlugs(page)).toEqual([]);
    await expect(page.getByRole("navigation", { name: "Phân trang hàng mới" })).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Chưa có sản phẩm mới" })).toHaveCount(0);
    await expectClean(page);

    // The query string is ignored exactly as before: even a value ON would refuse is a plain 200.
    for (const query of ["?page=2", "?page=999", "?page=abc"]) {
      const ignored = await request.get(`${OFF_URL}/new-arrivals${query}`, { maxRedirects: 0 });
      expect(ignored.status(), query).toBe(200);
    }
    await expect(page).toHaveTitle(/^Hàng mới( — [^—]+)?$/);
    await expect(page).not.toHaveTitle(/Trang/);
  });
});
