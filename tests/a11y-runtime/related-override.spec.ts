import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { auth } from "../../src/auth/server.ts";
import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags.ts";

/**
 * B05: the manual related-products override. The admin editor and the product page run against one dev
 * server with the flag ON, then the product page is checked again on a server with the flag OFF (one
 * Next dev server per project directory can run at a time, so the two run one after the other).
 */

const HOST = "127.0.0.1";
const ON_PORT = 3338;
const OFF_PORT = 3339;
const SHOP_ID = 920_043;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const PREFIX = "rel-override";
const runId = `${Date.now()}-${process.pid}`;
const adminEmail = `admin-rel-override-${runId}@example.invalid`;
const password = "admin-rel-override-runtime-password-123";

type Running = { child: ChildProcess; output: () => string };
let adminCookies: Array<{ name: string; value: string; url: string }> = [];
const ids: string[] = [];
const slugs: string[] = [];

function cookiesFrom(headers: Headers) {
  return headers.getSetCookie().map((header) => {
    const pair = header.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) {
      throw new Error("Better Auth returned a malformed Set-Cookie header");
    }
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      url: `http://${HOST}:${ON_PORT}`,
    };
  });
}



function startServer(port: number, enabled: boolean): Running {
  let output = "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PANCAKE_SHOP_ID: String(SHOP_ID),
    BETTER_AUTH_URL: `http://${HOST}:${port}`,
    APP_DOMAIN: `${HOST}:${port}`,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  if (enabled) env.RELATED_PRODUCTS_OVERRIDE_ENABLED = "true";
  else delete env.RELATED_PRODUCTS_OVERRIDE_ENABLED;
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
  return { child, output: () => output };
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
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

/** Index 0 is the product page under test; the rest are candidates. None share a collection. */
async function seed(count: number) {
  const syncedAt = new Date("2026-01-01T00:00:00.000Z");
  for (let index = 0; index < count; index += 1) {
    const key = `${PREFIX}-${String(index).padStart(2, "0")}`;
    const created = await prisma.productMirror.create({
      data: {
        pancakeShopId: SHOP_ID,
        pancakeProductId: key,
        slug: key,
        name: `${PREFIX} ${String(index).padStart(2, "0")}`,
        syncedAt,
        content: { create: { status: "PUBLISHED", editorialDescription: `Editorial ${key}`, collectionSlugs: [] } },
      },
    });
    const variant = await prisma.variantMirror.create({
      data: {
        id: key,
        pancakeVariationId: key,
        productId: created.id,
        color: "Ink",
        size: "M",
        pancakeRetailPrice: 250_000,
        pancakeRetailPriceAfterDiscount: 250_000,
        syncedAt,
      },
    });
    await prisma.warehouseStock.create({
      data: { variantId: variant.id, pancakeWarehouseId: "w0", quantity: 5, syncedAt },
    });
    ids.push(created.id);
    slugs.push(key);
  }
}

async function overrides(indexes: number[]) {
  await prisma.relatedProductOverride.deleteMany({ where: { productId: ids[0]! } });
  await prisma.relatedProductOverride.createMany({
    data: indexes.map((index, position) => ({ productId: ids[0]!, relatedProductId: ids[index]!, position })),
  });
}

async function relatedNames(page: Page): Promise<string[]> {
  const region = page.getByRole("region", { name: "Hoàn thiện phối đồ" });
  if ((await region.count()) === 0) return [];
  return region.locator("article h2").allTextContents();
}

const name = (index: number) => `${PREFIX} ${String(index).padStart(2, "0")}`;

test.beforeAll(async () => {
  await cleanup();
  await seed(10);
  const { headers } = await auth.api.signUpEmail({
    returnHeaders: true,
    headers: new Headers({ "x-ci-client-ip": "203.0.113.53" }),
    body: { name: "Related Override Runtime", email: adminEmail, password },
  });
  adminCookies = cookiesFrom(headers);
  expect(adminCookies.length).toBeGreaterThan(0);
  await prisma.user.update({ where: { email: adminEmail }, data: { role: "ADMIN" } });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

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
  const url = `http://${HOST}:${ON_PORT}`;

  test("the product page shows the manual candidates in order, skipping a hidden one", async ({ page }) => {
    await overrides([6, 3, 8, 2, 5]);
    await prisma.productMirror.update({ where: { id: ids[8]! }, data: { isActive: false } });

    const response = await page.goto(`${url}/shop/${slugs[0]}`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    const names = await relatedNames(page);
    // Stored: 6, 3, 8 (hidden), 2, 5 -> the rail shows the first four visible ones.
    expect(names).toEqual([name(6), name(3), name(2), name(5)]);
    expect(names).not.toContain(name(0));

    await prisma.productMirror.update({ where: { id: ids[8]! }, data: { isActive: true } });
  });

  test("with no override the page falls back exactly as before (no collection => no related region)", async ({ page }) => {
    await prisma.relatedProductOverride.deleteMany({ where: { productId: ids[0]! } });
    await page.goto(`${url}/shop/${slugs[0]}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("region", { name: "Hoàn thiện phối đồ" })).toHaveCount(0);

    // An override whose products are all hidden also falls back, instead of an empty or broken rail.
    await overrides([4]);
    await prisma.productMirror.update({ where: { id: ids[4]! }, data: { isActive: false } });
    await page.goto(`${url}/shop/${slugs[0]}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("region", { name: "Hoàn thiện phối đồ" })).toHaveCount(0);
    await prisma.productMirror.update({ where: { id: ids[4]! }, data: { isActive: true } });
  });

  test("the product page with candidates is accessible at 390px", async ({ page }) => {
    await overrides([1, 2]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${url}/shop/${slugs[0]}`, { waitUntil: "networkidle" });
    expect(await relatedNames(page)).toEqual([name(1), name(2)]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The title is streamed in after a server-action redirect; scanning before it lands reports a false "document-title" violation.
    await expect(page).toHaveTitle(/\S/);
    const scan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
    expect(scan.violations).toEqual([]);
  });

  test("the admin edits the list: add, reorder, remove, refuse a ninth, never offer the product itself", async ({ page, context }) => {
    await prisma.relatedProductOverride.deleteMany({ where: { productId: ids[0]! } });
    await context.addCookies(adminCookies);
    const path = `/admin/products/${ids[0]}/related`;
    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Sản phẩm liên quan thủ công" })).toBeVisible();
    // The title is streamed in after a server-action redirect; scanning before it lands reports a false "document-title" violation.
    await expect(page).toHaveTitle(/\S/);
    const emptyScan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
    expect(emptyScan.violations).toEqual([]);

    // The product itself is listed as already present, never as addable.
    await page.goto(`${url}${path}?q=${encodeURIComponent(name(0))}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: `Thêm ${name(0)}` })).toHaveCount(0);

    for (const index of [1, 2, 3, 4, 5, 6, 7, 8]) {
      await page.goto(`${url}${path}?q=${encodeURIComponent(name(index))}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: `Thêm ${name(index)}` }).click();
      await page.waitForURL((u) => u.pathname === path && u.searchParams.get("saved") === "1");
    }
    const stored = async () =>
      (await prisma.relatedProductOverride.findMany({ where: { productId: ids[0]! }, orderBy: { position: "asc" } })).map(
        (row) => row.relatedProductId,
      );
    expect(await stored()).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((index) => ids[index]));

    await page.goto(`${url}${path}?q=${encodeURIComponent(name(9))}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Thêm ${name(9)}` }).click();
    await page.waitForURL((u) => u.pathname === path && u.searchParams.get("error") === "TOO_MANY");
    const alert = page.getByRole("alert").filter({ hasText: "tối đa 8" });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    expect(await stored()).toHaveLength(8);

    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    // Ties keep the rendered order, so giving 8 the first place means moving 1 to the second.
    await page.getByLabel(`Thứ tự của ${name(8)}`).fill("1");
    await page.getByLabel(`Thứ tự của ${name(1)}`).fill("2");
    await page.getByLabel(`Gỡ ${name(2)}`).check();
    await page.getByRole("button", { name: "Lưu thứ tự" }).click();
    await page.waitForURL((u) => u.pathname === path && u.searchParams.get("saved") === "1");
    expect((await stored()).slice(0, 3)).toEqual([ids[8], ids[1], ids[3]]);
    expect(await stored()).not.toContain(ids[2]);

    // The title is streamed in after a server-action redirect; scanning before it lands reports a false "document-title" violation.
    await expect(page).toHaveTitle(/\S/);
    const filledScan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
    expect(filledScan.violations).toEqual([]);
  });

  test("an unauthenticated visitor never sees the editor", async ({ page }) => {
    await page.goto(`${url}/admin/products/${ids[0]}/related`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).toBe("/account");
  });
});

test.describe("flag OFF (default)", () => {
  withServer(OFF_PORT, false);
  const url = `http://${HOST}:${OFF_PORT}`;

  test("the product page ignores stored overrides", async ({ page }) => {
    await overrides([6, 3]);
    const response = await page.goto(`${url}/shop/${slugs[0]}`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("region", { name: "Hoàn thiện phối đồ" })).toHaveCount(0);
  });
});
