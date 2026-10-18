import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { auth } from "../../src/auth/server.ts";
import { prisma } from "../../src/db/prisma.ts";

const HOST = "127.0.0.1";
const PORT = 3333;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");

const runId = `${Date.now()}-${process.pid}`;
const adminEmail = `admin-new-arrivals-${runId}@example.invalid`;
const password = "admin-new-arrivals-runtime-password-123";
const tag = `admin-new-arrivals-${runId}`;

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
  await prisma.newArrivalsSelection.deleteMany();
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: "admin-new-arrivals-" } } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

const productNames = ["Alpha Coat", "Bravo Coat", "Charlie Coat"];
const productIds = new Map<string, string>();

async function seedProducts() {
  for (const [index, name] of productNames.entries()) {
    const pancakeProductId = `${tag}-${index}`;
    const created = await prisma.productMirror.create({
      data: {
        pancakeShopId: 999_005,
        pancakeProductId,
        slug: pancakeProductId,
        name: `${tag} ${name}`,
        syncedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    productIds.set(name, created.id);
  }
}

async function storedOrder() {
  const rows = await prisma.newArrivalsSelection.findMany({ orderBy: { position: "asc" } });
  return rows.map((row) => row.productId);
}

test.beforeAll(async () => {
  await cleanupDatabase();
  await seedProducts();

  const { headers } = await auth.api.signUpEmail({
    returnHeaders: true,
    headers: new Headers({ "x-ci-client-ip": "203.0.113.33" }),
    body: {
      name: "New Arrivals A11y Runtime",
      email: adminEmail,
      password,
    },
  });
  adminCookies = cookiesFrom(headers);
  expect(adminCookies.length).toBeGreaterThan(0);

  await prisma.user.update({
    where: { email: adminEmail },
    data: { role: "ADMIN" },
  });

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      // Better Auth rejects callbacks whose origin does not match its configured base URL,
      // so it has to follow this spec's own port rather than a value pinned in the workflow.
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

test("admin curates the New Arrivals order with accessible feedback and persisted ordering", async ({
  page,
  context,
}) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

  await context.addCookies(adminCookies);
  const path = "/admin/new-arrivals";
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { level: 1, name: "Hàng mới" })).toBeVisible();
  await expect(page.getByText("Chưa có sản phẩm nào trong danh sách.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The title is streamed in after a server-action redirect; scanning before it lands reports a false "document-title" violation.
  await expect(page).toHaveTitle(/\S/);
  const emptyScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(emptyScan.violations).toEqual([]);

  // Search, then add each product. The search form is a GET, so it works without script.
  for (const name of productNames) {
    await page.goto(`${BASE_URL}${path}?q=${encodeURIComponent(`${tag} ${name}`)}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Thêm ${tag} ${name}` }).click();
    await page.waitForURL((url) => url.pathname === path && url.searchParams.get("saved") === "1");
  }
  expect(await storedOrder()).toEqual(productNames.map((name) => productIds.get(name)));

  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  // The title is streamed in after a server-action redirect; scanning before it lands reports a false "document-title" violation.
  await expect(page).toHaveTitle(/\S/);
  const filledScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(filledScan.violations).toEqual([]);
  await expect(page.getByRole("table")).toBeVisible();

  // Move Charlie to the front by giving it position 1 and Alpha/Bravo 2 and 3.
  await page.getByLabel(`Thứ tự của ${tag} Charlie Coat`).fill("1");
  await page.getByLabel(`Thứ tự của ${tag} Alpha Coat`).fill("2");
  await page.getByLabel(`Thứ tự của ${tag} Bravo Coat`).fill("3");
  await page.getByRole("button", { name: "Lưu thứ tự" }).click();
  await page.waitForURL((url) => url.pathname === path && url.searchParams.get("saved") === "1");
  const saved = page.getByRole("status").filter({ hasText: "Đã lưu danh sách hàng mới." });
  await expect(saved).toBeFocused();
  expect(await storedOrder()).toEqual(["Charlie Coat", "Alpha Coat", "Bravo Coat"].map((n) => productIds.get(n)));

  // Removal by keyboard-reachable checkbox. Start from the clean URL so the wait below cannot be
  // satisfied by the `?saved=1` left over from the previous save.
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  await page.getByLabel(`Gỡ ${tag} Alpha Coat`).check();
  await page.getByRole("button", { name: "Lưu thứ tự" }).click();
  await page.waitForURL((url) => url.pathname === path && url.searchParams.get("saved") === "1");
  expect(await storedOrder()).toEqual(["Charlie Coat", "Bravo Coat"].map((n) => productIds.get(n)));

  expect(browserErrors).toEqual([]);
});

test("a stale editor gets an announced refusal and the newer order survives", async ({ page, context }) => {
  // Self-contained: seed two slots directly instead of depending on the previous test.
  await prisma.newArrivalsSelection.deleteMany();
  await prisma.newArrivalsSelection.createMany({
    data: [
      { productId: productIds.get("Charlie Coat")!, position: 0 },
      { productId: productIds.get("Bravo Coat")!, position: 1 },
    ],
  });
  await prisma.newArrivalsSelectionState.upsert({
    where: { id: "current" },
    create: { id: "current", revision: 7 },
    update: {},
  });

  await context.addCookies(adminCookies);
  const path = "/admin/new-arrivals";
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("table")).toBeVisible();
  const before = await storedOrder();

  // Another editor changes the list while this page is open.
  await prisma.$transaction([
    prisma.newArrivalsSelectionState.update({ where: { id: "current" }, data: { revision: { increment: 1 } } }),
  ]);

  await page.getByLabel(`Gỡ ${tag} Bravo Coat`).check();
  await page.getByRole("button", { name: "Lưu thứ tự" }).click();
  await page.waitForURL((url) => url.pathname === path && url.searchParams.get("error") === "STALE_REVISION");
  const alert = page.getByRole("alert").filter({ hasText: "Danh sách vừa được người khác thay đổi." });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  expect(await storedOrder()).toEqual(before);

  // The title is streamed in after a server-action redirect; scanning before it lands reports a false "document-title" violation.
  await expect(page).toHaveTitle(/\S/);
  const errorScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(errorScan.violations).toEqual([]);

  // An unknown reason never reaches the page as text.
  await page.goto(`${BASE_URL}${path}?error=%3Cscript%3E`, { waitUntil: "networkidle" });
  await expect(page.getByRole("alert").filter({ hasText: "Dữ liệu không hợp lệ." })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("<script>");
});

test("an unauthenticated visitor never sees the curator", async ({ page }) => {
  const response = await page.goto(`${BASE_URL}/admin/new-arrivals`, { waitUntil: "networkidle" });
  expect(response?.status()).toBeLessThan(400);
  expect(new URL(page.url()).pathname).toBe("/account");
  await expect(page.getByRole("heading", { level: 1, name: "Hàng mới" })).toHaveCount(0);
});
