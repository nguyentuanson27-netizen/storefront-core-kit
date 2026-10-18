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
 * B04: the homepage featured selection. The admin curator and the homepage run against one dev
 * server with the flag ON, then the homepage is checked again on a server with the flag OFF (one
 * Next dev server per project directory can run at a time, so the two run one after the other).
 */

const HOST = "127.0.0.1";
const ON_PORT = 3336;
const OFF_PORT = 3337;
const SHOP_ID = 920_042;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const PREFIX = "hp-featured";
const runId = `${Date.now()}-${process.pid}`;
const adminEmail = `admin-hp-featured-${runId}@example.invalid`;
const password = "admin-hp-featured-runtime-password-123";

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
  if (enabled) env.HOMEPAGE_FEATURED_ENABLED = "true";
  else delete env.HOMEPAGE_FEATURED_ENABLED;
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
  await prisma.homepageFeaturedProduct.deleteMany();
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

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
        syncedAt,
      },
    });
    await prisma.warehouseStock.create({
      data: { variantId: key, pancakeWarehouseId: "w0", quantity: 5, syncedAt },
    });
    ids.push(created.id);
    slugs.push(key);
  }
}

async function select(indexes: number[]) {
  await prisma.homepageFeaturedProduct.deleteMany();
  await prisma.homepageFeaturedProduct.createMany({
    data: indexes.map((index, position) => ({ productId: ids[index]!, position })),
  });
}

async function cardSlugs(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator(`#shop-edit-title ~ * a[href^="/shop/${PREFIX}-"], section[aria-labelledby="shop-edit-title"] a[href^="/shop/${PREFIX}-"]`)
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""));
  return [...new Set(hrefs.map((href) => href.replace("/shop/", "")))];
}

test.beforeAll(async () => {
  await cleanup();
  await seed(14);
  const { headers } = await auth.api.signUpEmail({
    returnHeaders: true,
    headers: new Headers({ "x-ci-client-ip": "203.0.113.43" }),
    body: { name: "Homepage Featured Runtime", email: adminEmail, password },
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

  test("homepage lists the curated products in stored order, dropping a hidden one without refilling", async ({ page }) => {
    await select([7, 2, 11, 4]);
    await prisma.productMirror.update({ where: { id: ids[11]! }, data: { isActive: false } });

    const response = await page.goto(`${url}/`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    expect(await cardSlugs(page)).toEqual([slugs[7], slugs[2], slugs[4]]);

    await prisma.productMirror.update({ where: { id: ids[11]! }, data: { isActive: true } });
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    expect(await cardSlugs(page)).toEqual([slugs[7], slugs[2], slugs[11], slugs[4]]);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The title is streamed in after a server-action redirect; scanning before it lands reports a false "document-title" violation.
    await expect(page).toHaveTitle(/\S/);
    const scan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
    expect(scan.violations).toEqual([]);
  });

  test("an empty selection, or one whose products are all hidden, falls back to automatic discovery", async ({ page }) => {
    await select([]);
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    const automatic = await cardSlugs(page);
    expect(automatic).toEqual(slugs, "all 14 seeded products, by name");

    await select([3]);
    await prisma.productMirror.update({ where: { id: ids[3]! }, data: { isActive: false } });
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    expect(await cardSlugs(page)).toEqual(slugs.filter((_slug, index) => index !== 3));
    await prisma.productMirror.update({ where: { id: ids[3]! }, data: { isActive: true } });
  });

  test("the admin curates up to 12 with accessible feedback and a refused 13th", async ({ page, context }) => {
    await select([]);
    await context.addCookies(adminCookies);
    const path = "/admin/homepage-featured";
    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Nổi bật trang chủ" })).toBeVisible();
    await expect(page.getByText("Chưa có sản phẩm nào trong danh sách.")).toBeVisible();
    // The title is streamed in after a server-action redirect; scanning before it lands reports a false "document-title" violation.
    await expect(page).toHaveTitle(/\S/);
    const emptyScan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
    expect(emptyScan.violations).toEqual([]);

    for (let index = 0; index < 12; index += 1) {
      await page.goto(`${url}${path}?q=${encodeURIComponent(`${PREFIX} ${String(index).padStart(2, "0")}`)}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: `Thêm ${PREFIX} ${String(index).padStart(2, "0")}` }).click();
      await page.waitForURL((u) => u.pathname === path && u.searchParams.get("saved") === "1");
    }
    expect(await prisma.homepageFeaturedProduct.count()).toBe(12);

    await page.goto(`${url}${path}?q=${encodeURIComponent(`${PREFIX} 12`)}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Thêm ${PREFIX} 12` }).click();
    await page.waitForURL((u) => u.pathname === path && u.searchParams.get("error") === "TOO_MANY");
    const alert = page.getByRole("alert").filter({ hasText: "tối đa 12 sản phẩm" });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    expect(await prisma.homepageFeaturedProduct.count()).toBe(12);

    // The title is streamed in after a server-action redirect; scanning before it lands reports a false "document-title" violation.
    await expect(page).toHaveTitle(/\S/);
    const filledScan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
    expect(filledScan.violations).toEqual([]);
  });

  test("an unauthenticated visitor never sees the curator", async ({ page }) => {
    await page.goto(`${url}/admin/homepage-featured`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).toBe("/account");
  });
});

test.describe("flag OFF (default)", () => {
  withServer(OFF_PORT, false);
  const url = `http://${HOST}:${OFF_PORT}`;

  test("the homepage ignores the selection and keeps automatic discovery", async ({ page }) => {
    await select([7, 2, 11, 4]);
    const response = await page.goto(`${url}/`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    expect(await cardSlugs(page)).toEqual(slugs);
  });
});
