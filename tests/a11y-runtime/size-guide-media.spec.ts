import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { auth } from "../../src/auth/server.ts";
import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags.ts";

/**
 * B06: optional trusted chart images on /size-guide. The admin editor and the page run against one dev
 * server with the flag ON, then the page is checked again on a server with the flag OFF (one Next dev
 * server per project directory can run at a time, so the two run one after the other).
 */

const HOST = "127.0.0.1";
const ON_PORT = 3340;
const OFF_PORT = 3341;
const SHOP_ID = 920_044;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const runId = `${Date.now()}-${process.pid}`;
const adminEmail = `admin-size-guide-${runId}@example.invalid`;
const password = "admin-size-guide-runtime-password-123";
const GOOD_URL = "https://content.pancake.vn/1/2/3/4/photo-size-guide.jpg";
const BAD_URL = "https://example.com/1/2/3/4/photo-size-guide.jpg";

type Running = { child: ChildProcess; output: () => string };
let adminCookies: Array<{ name: string; value: string; url: string }> = [];

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
  if (enabled) env.SIZE_GUIDE_MEDIA_ENABLED = "true";
  else delete env.SIZE_GUIDE_MEDIA_ENABLED;
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
  await prisma.sizeGuideMedia.deleteMany();
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

test.beforeAll(async () => {
  await cleanup();
  const { headers } = await auth.api.signUpEmail({
    returnHeaders: true,
    headers: new Headers({ "x-ci-client-ip": "203.0.113.63" }),
    body: { name: "Size Guide Runtime", email: adminEmail, password },
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

async function firstChartKey(): Promise<string> {
  const { buildSizeGuideViewModel } = await import("../../src/routes/evergreen-model.ts");
  return buildSizeGuideViewModel().charts[0]!.id;
}

test.describe("flag ON", () => {
  withServer(ON_PORT, true);
  const url = `http://${HOST}:${ON_PORT}`;

  test("the admin refuses an untrusted image and stores a trusted one with accessible feedback", async ({ page, context }) => {
    const key = await firstChartKey();
    await context.addCookies(adminCookies);
    const path = "/admin/size-guide";
    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Ảnh bảng size" })).toBeVisible();
    const emptyScan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
    expect(emptyScan.violations).toEqual([]);

    const form = page.locator("form").filter({ has: page.locator(`input[name="guideKey"][value="${key}"]`) }).first();
    await form.getByLabel("Liên kết ảnh").fill(BAD_URL);
    await form.getByLabel("Mô tả ảnh (alt)").fill("Sơ đồ đo");
    await form.getByLabel("Chiều rộng (px)").fill("1200");
    await form.getByLabel("Chiều cao (px)").fill("800");
    await form.getByRole("button", { name: /Lưu ảnh/ }).click();
    await page.waitForURL((u) => u.pathname === path && u.searchParams.get("error") === "UNTRUSTED_IMAGE");
    const alert = page.getByRole("alert").filter({ hasText: "nguồn ảnh đã được duyệt" });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    expect(await prisma.sizeGuideMedia.count()).toBe(0);

    const retry = page.locator("form").filter({ has: page.locator(`input[name="guideKey"][value="${key}"]`) }).first();
    await retry.getByLabel("Liên kết ảnh").fill(GOOD_URL);
    await retry.getByLabel("Mô tả ảnh (alt)").fill("Sơ đồ đo");
    await retry.getByLabel("Chiều rộng (px)").fill("1200");
    await retry.getByLabel("Chiều cao (px)").fill("800");
    await retry.getByRole("button", { name: /Lưu ảnh/ }).click();
    await page.waitForURL((u) => u.pathname === path && u.searchParams.get("saved") === "1");
    await expect(page.getByRole("status").filter({ hasText: "Đã lưu ảnh bảng size." })).toBeFocused();
    const row = await prisma.sizeGuideMedia.findUniqueOrThrow({ where: { guideKey: key } });
    expect(row.imageUrl).toBe(GOOD_URL);

    const filledScan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
    expect(filledScan.violations).toEqual([]);
  });

  test("the size guide shows the image beside its approved table, and only for that chart", async ({ page }) => {
    const key = await firstChartKey();
    await prisma.sizeGuideMedia.deleteMany();
    await prisma.sizeGuideMedia.create({
      data: { guideKey: key, imageUrl: GOOD_URL, altText: "Sơ đồ đo ngực", width: 1200, height: 800 },
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const response = await page.goto(`${url}/size-guide`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    const section = page.locator(`section[aria-labelledby="chart-${key}-heading"]`);
    const image = section.locator("img");
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute("alt", "Sơ đồ đo ngực");
    await expect(image).toHaveAttribute("width", "1200");
    await expect(image).toHaveAttribute("height", "800");
    await expect(section.getByRole("table")).toBeVisible();
    await expect(page.locator("main img, section img")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const scan = await new AxeBuilder({ page }).withTags(BUYER_AXE_TAGS).analyze();
    expect(scan.violations).toEqual([]);
  });

  test("a stored row that no longer passes the trust rule never reaches the page", async ({ page }) => {
    const key = await firstChartKey();
    await prisma.sizeGuideMedia.deleteMany();
    // Written straight to the table, as a stale or hand-edited row would be.
    await prisma.$executeRaw`INSERT INTO "SizeGuideMedia" ("guideKey","imageUrl","altText","width","height","updatedAt") VALUES (${key}, ${BAD_URL}, 'x', 10, 10, now())`;
    await page.goto(`${url}/size-guide`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(`section[aria-labelledby="chart-${key}-heading"] img`)).toHaveCount(0);
    await expect(page.getByRole("table").first()).toBeVisible();
  });

  test("an unauthenticated visitor never sees the editor", async ({ page }) => {
    await page.goto(`${url}/admin/size-guide`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).toBe("/account");
  });
});

test.describe("flag OFF (default)", () => {
  withServer(OFF_PORT, false);
  const url = `http://${HOST}:${OFF_PORT}`;

  test("the size guide ignores stored images and renders the approved tables only", async ({ page }) => {
    const key = await firstChartKey();
    await prisma.sizeGuideMedia.deleteMany();
    await prisma.sizeGuideMedia.create({
      data: { guideKey: key, imageUrl: GOOD_URL, altText: "Sơ đồ đo ngực", width: 1200, height: 800 },
    });
    const response = await page.goto(`${url}/size-guide`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator(`section[aria-labelledby="chart-${key}-heading"] img`)).toHaveCount(0);
    await expect(page.getByRole("table").first()).toBeVisible();
  });
});
