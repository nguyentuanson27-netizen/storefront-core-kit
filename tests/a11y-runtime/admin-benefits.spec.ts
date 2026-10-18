import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { auth } from "../../src/auth/server.ts";
import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags.ts";

const HOST = "127.0.0.1";
const PORT = 3342;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");

const runId = `${Date.now()}-${process.pid}`;
const adminEmail = `admin-benefits-${runId}@example.invalid`;
const password = "admin-benefits-runtime-password-123";
const tag = `admin-benefits-${runId}`;

let server: ChildProcess | undefined;
let serverOutput = "";
let adminCookies: Array<{ name: string; value: string; url: string }> = [];

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

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
      url: BASE_URL,
    };
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js a11y server exited with ${server.exitCode}\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }

  throw new Error(`Timed out waiting for Next.js a11y server\n${serverOutput}`);
}

async function waitForServerExit(timeoutMs: number) {
  if (!server || server.exitCode !== null) return true;
  return Promise.race([
    once(server, "exit").then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  if (await waitForServerExit(5_000)) return;
  server.kill("SIGKILL");
  await waitForServerExit(5_000);
}

async function cleanupDatabase() {
  await prisma.benefitCampaign.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: "admin-benefits-" } } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

const path = "/admin/benefits";
let productSlug = "";
let giftVariationId = "";

async function scan(page: import("@playwright/test").Page) {
  // Wait for the title the server action's redirect renders, so the scan never sees a transient page.
  await expect(page).toHaveTitle(/\S/);
  const result = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
  expect(result.violations).toEqual([]);
}

async function fillCreateForm(
  page: import("@playwright/test").Page,
  name: string,
  fields: { kind?: string; thresholdKind?: string; slugs?: string; thresholds?: string[]; percents?: string[]; gift?: [string, string] },
) {
  await page.getByLabel("Tên ưu đãi").fill(name);
  await page.getByLabel("Loại ưu đãi").selectOption(fields.kind ?? "QUANTITY_TIER");
  await page.getByLabel("Ngưỡng tính theo").selectOption(fields.thresholdKind ?? "QUANTITY");
  await page.getByLabel(/^Slug sản phẩm áp dụng/).fill(fields.slugs ?? "");
  for (const [index, value] of (fields.thresholds ?? []).entries()) {
    await page.getByLabel(`Ngưỡng của mức ${index + 1}`).fill(value);
  }
  for (const [index, value] of (fields.percents ?? []).entries()) {
    await page.getByLabel(`Giảm % của mức ${index + 1}`).fill(value);
  }
  if (fields.gift) {
    await page.getByLabel("Mã biến thể quà 1").fill(fields.gift[0]);
    await page.getByLabel("Số lượng quà 1").fill(fields.gift[1]);
  }
  await page.getByRole("button", { name: "Lưu nháp" }).click();
}

test.beforeAll(async () => {
  await cleanupDatabase();
  productSlug = `${tag}-p`;
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: 999_011,
      pancakeProductId: productSlug,
      slug: productSlug,
      name: `${tag} Coat`,
      syncedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  giftVariationId = `${tag}-gift`;
  await prisma.variantMirror.create({
    data: { id: giftVariationId, pancakeVariationId: giftVariationId, productId: product.id, syncedAt: new Date("2026-01-01T00:00:00.000Z") },
  });

  const { headers } = await auth.api.signUpEmail({
    returnHeaders: true,
    headers: new Headers({ "x-ci-client-ip": "203.0.113.34" }),
    body: { name: "Benefits A11y Runtime", email: adminEmail, password },
  });
  adminCookies = cookiesFrom(headers);
  expect(adminCookies.length).toBeGreaterThan(0);
  await prisma.user.update({ where: { email: adminEmail }, data: { role: "ADMIN" } });

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      BETTER_AUTH_URL: BASE_URL,
      APP_DOMAIN: `${HOST}:${PORT}`,
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
  await cleanupDatabase();
  await prisma.$disconnect();
});

test("admin drafts, publishes and disables a campaign with accessible feedback", async ({ page, context }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

  await context.addCookies(adminCookies);
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "Ưu đãi theo giỏ hàng" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await scan(page);

  const name = `${tag} tier`;
  await fillCreateForm(page, name, { slugs: productSlug, thresholds: ["2", "4"], percents: ["10", "20"] });
  await page.waitForURL((url) => url.pathname === path && url.searchParams.get("saved") === "1");
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu ưu đãi." })).toBeFocused();

  const stored = await prisma.benefitCampaign.findFirstOrThrow({
    where: { name },
    include: { tiers: { orderBy: { position: "asc" } }, targets: true },
  });
  expect(stored.isEnabled).toBe(false);
  expect(stored.tiers.map((tier) => [tier.thresholdQuantity, tier.percentageValue])).toEqual([[2, 10], [4, 20]]);
  expect(stored.targets).toHaveLength(1);

  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("table")).toBeVisible();
  await scan(page);

  await page.getByRole("button", { name: `Bật ${name}` }).click();
  await page.waitForURL((url) => url.pathname === path && url.searchParams.get("saved") === "1");
  expect((await prisma.benefitCampaign.findUniqueOrThrow({ where: { id: stored.id } })).isEnabled).toBe(true);

  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: `Tắt ${name}` }).click();
  await page.waitForURL((url) => url.pathname === path && url.searchParams.get("saved") === "1");
  expect((await prisma.benefitCampaign.findUniqueOrThrow({ where: { id: stored.id } })).isEnabled).toBe(false);

  expect(browserErrors).toEqual([]);
});

test("a conflicting publish is refused, names the other campaign and changes nothing", async ({ page, context }) => {
  await prisma.benefitCampaign.deleteMany({ where: { name: { startsWith: tag } } });
  const product = await prisma.productMirror.findFirstOrThrow({ where: { slug: productSlug } });
  const make = (suffix: string) =>
    prisma.benefitCampaign.create({
      data: {
        kind: "QUANTITY_TIER",
        name: `${tag} ${suffix}`,
        targets: { create: [{ productId: product.id }] },
        tiers: { create: [{ position: 0, thresholdQuantity: 2, percentageValue: 10 }] },
      },
    });
  const first = await make("first");
  await prisma.benefitCampaign.update({ where: { id: first.id }, data: { isEnabled: true, enabledAt: new Date() } });
  const second = await make("second");

  await context.addCookies(adminCookies);
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: `Bật ${tag} second` }).click();
  await page.waitForURL((url) => url.pathname === path && url.searchParams.get("error") === "CONFLICT");

  const alert = page.getByRole("alert").filter({ hasText: "trùng phạm vi và thời gian" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(`${tag} first`);
  await expect(alert).toBeFocused();
  expect((await prisma.benefitCampaign.findUniqueOrThrow({ where: { id: second.id } })).isEnabled).toBe(false);
  await scan(page);
});

test("invalid input is refused with an announced message and nothing is stored", async ({ page, context }) => {
  await context.addCookies(adminCookies);
  const before = await prisma.benefitCampaign.count({ where: { name: { startsWith: tag } } });

  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  await fillCreateForm(page, `${tag} bad`, { thresholds: ["2"], percents: ["100"] });
  await page.waitForURL((url) => url.pathname === path && url.searchParams.get("error") === "INVALID_TIERS");
  await expect(page.getByRole("alert").filter({ hasText: "mức giảm giá từ 1 đến 99%" })).toBeFocused();

  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  await fillCreateForm(page, `${tag} unknown`, { slugs: "no-such-product", thresholds: ["2"], percents: ["10"] });
  await page.waitForURL((url) => url.pathname === path && url.searchParams.get("error") === "UNKNOWN_TARGET");
  await expect(page.getByRole("alert").filter({ hasText: "không tồn tại trong danh mục" })).toBeVisible();

  expect(await prisma.benefitCampaign.count({ where: { name: { startsWith: tag } } })).toBe(before);

  await page.goto(`${BASE_URL}${path}?error=%3Cscript%3E`, { waitUntil: "networkidle" });
  await expect(page.locator("body")).not.toContainText("<script>");
  await scan(page);
});

test("a gift campaign resolves its gift by variation id", async ({ page, context }) => {
  await context.addCookies(adminCookies);
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  const name = `${tag} gift`;
  await fillCreateForm(page, name, { kind: "GIFT_ITEM", thresholdKind: "SUBTOTAL", thresholds: ["500000"], gift: [giftVariationId, "2"] });
  await page.waitForURL((url) => url.pathname === path && url.searchParams.get("saved") === "1");
  const stored = await prisma.benefitCampaign.findFirstOrThrow({ where: { name }, include: { gifts: true, tiers: true } });
  expect(stored.gifts.map((gift) => [gift.variantId, gift.quantity])).toEqual([[giftVariationId, 2]]);
  expect(stored.tiers[0]?.thresholdSubtotalVnd).toBe(BigInt(500_000));
});

test("an unauthenticated visitor never sees the page", async ({ page }) => {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname).toBe("/account");
  await expect(page.getByRole("heading", { level: 1, name: "Ưu đãi theo giỏ hàng" })).toHaveCount(0);
});
