import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createProductCommerceAdminService } from "../../src/commerce/product-commerce-admin.ts";
import { createProductCommerceRepository } from "../../src/commerce/product-commerce-repository.ts";
import { prisma } from "../../src/db/prisma.ts";
import { BUYER_AXE_TAGS } from "./axe-tags";

const HOST = "127.0.0.1";
const PORT = 3326;
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_ROOT = resolve(import.meta.dirname, "../..");
const NEXT_CLI = resolve(APP_ROOT, "node_modules/next/dist/bin/next");
const SHOP_ID = 920_012;
const runId = `${Date.now()}-${process.pid}`;
const parentExternalId = `composite-browser-parent-${runId}`;
const parentSlug = `composite-browser-set-${runId}`;
const parentName = `Composite Browser Set ${runId}`;
const parentVariantExternalId = `composite-browser-parent-variant-${runId}`;
const componentExternalId = `composite-browser-component-${runId}`;
const componentSlug = `composite-browser-shirt-${runId}`;
const componentName = `Áo lẻ Browser ${runId}`;
const componentVariantExternalId = `composite-browser-component-variant-${runId}`;
const syncedAt = new Date("2026-08-23T00:00:00.000Z");

let server: ChildProcess | undefined;
let serverOutput = "";
let componentProductId = "";
let componentVariantId = "";
let parentVariantId = "";

const activationSecret = "composite-fixture-confirmation-secret-1234";
const commerceRepository = createProductCommerceRepository(prisma);
// The fixtures drive the same generic activation service the admin editor uses, so a regression
// in the real path shows up here instead of in a service nothing ships.
const commerceService = createProductCommerceAdminService({
  setVariantActivation: commerceRepository.setVariantActivation,
  readCatalogEnableWarningState: commerceRepository.readCatalogEnableWarningState,
  commitCatalogEnable: commerceRepository.commitCatalogEnable,
  disableCatalog: commerceRepository.disableCatalog,
  activateProductAndStockedVariants: commerceRepository.activateProductAndStockedVariants,
  readConfirmationSecret: () => activationSecret,
  nowMs: () => Date.now(),
});
const adminSession = {
  user: { id: "composite-browser-admin", role: "ADMIN" },
  session: { id: "composite-browser-session" },
} as const;

function captureServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Next.js composite storefront server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/shop/${parentSlug}`, { redirect: "manual" });
      if (response.status === 200) {
        const text = await response.text();
        if (text.includes(parentName)) return;
      }
    } catch {
      // Next dev may still be compiling.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for composite storefront server\n${serverOutput}`);
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

async function assertPageQuality(page: import("@playwright/test").Page) {
  const overflowReport = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(overflowReport.documentWidth).toBeLessThanOrEqual(overflowReport.viewportWidth);

  const accessibilityScan = await new AxeBuilder({ page })
    .withTags(BUYER_AXE_TAGS)
    .analyze();
  expect(accessibilityScan.violations).toEqual([]);
}

test.beforeAll(async () => {
  await cleanup();

  const parent = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: parentExternalId,
      slug: parentSlug,
      name: parentName,
      isPresent: true,
      isActive: true,
      syncedAt,
      content: {
        create: {
          status: "PUBLISHED",
          editorialDescription: "Composite browser regression parent product.",
        },
      },
    },
  });
  const component = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: componentExternalId,
      slug: componentSlug,
      name: componentName,
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  componentProductId = component.id;

  const parentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: parentVariantExternalId,
      productId: parent.id,
      color: null,
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 790_000,
      pancakeRetailPriceAfterDiscount: 790_000,
      syncedAt,
    },
  });
  const componentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: componentVariantExternalId,
      productId: component.id,
      color: null,
      size: "M",
      isPresent: true,
      isActive: false,
      pancakeRetailPrice: 390_000,
      pancakeRetailPriceAfterDiscount: 390_000,
      syncedAt,
    },
  });

  componentVariantId = componentVariant.id;

  await prisma.warehouseStock.createMany({
    data: [
      {
        variantId: parentVariant.id,
        pancakeWarehouseId: `composite-browser-parent-warehouse-${runId}`,
        quantity: 0,
        syncedAt,
      },
      {
        variantId: componentVariant.id,
        pancakeWarehouseId: `composite-browser-component-warehouse-${runId}`,
        quantity: 2,
        syncedAt,
      },
    ],
  });
  // A set is offered only as many times as its components can supply (spec §5.1); the parent's
  // own mirrored 0 is not consulted. Three units per set against a component holding two keeps
  // the set out of stock for the activation walkthrough, which is about the component path.
  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parentVariant.id,
      componentVariantId: componentVariant.id,
      quantity: 3,
      syncedAt,
    },
  });
  parentVariantId = parentVariant.id;

  server = spawn(process.execPath, [NEXT_CLI, "dev", "--hostname", HOST, "--port", String(PORT)], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      APP_DOMAIN: `${HOST}:${PORT}`,
      PANCAKE_SHOP_ID: String(SHOP_ID),
      BETTER_AUTH_URL: BASE_URL,
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
  await cleanup();
  await prisma.$disconnect();
});

test("composite activation opens and closes the real child purchase path while parent schema stays authoritative", async ({
  page,
}) => {
  const directComponent = await page.request.get(`${BASE_URL}/shop/${componentSlug}`);
  expect(directComponent.status()).toBe(404);

  const browserErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${BASE_URL}/shop/${parentSlug}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: parentName })).toBeVisible();
  await expect(page.getByRole("group", { name: "Loại" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Set" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: componentName })).toHaveCount(0);

  expect(
    await commerceService.setVariantActivation(adminSession, componentProductId, {
      variantIds: [componentVariantId],
      isActive: true,
    }),
  ).toEqual({
    ok: true,
    variantIds: [componentVariantId],
    isActive: true,
  });

  const stillPrivateComponent = await page.request.get(`${BASE_URL}/shop/${componentSlug}`);
  expect(stillPrivateComponent.status()).toBe(404);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("radio", { name: "Set" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: componentName })).toBeEnabled();
  await expect(page.getByText("Chọn loại × kích cỡ", { exact: true })).toBeVisible();

  const structuredDocuments = (await page
    .locator('script[type="application/ld+json"]')
    .allTextContents()).map((value) => JSON.parse(value));
  const productNode = structuredDocuments
    .flatMap((document) => document["@graph"] ?? [])
    .find((node) => node["@type"] === "Product");
  expect(productNode).toBeDefined();
  expect(productNode.offers).toEqual({
    "@type": "Offer",
    url: `${BASE_URL}/shop/${parentSlug}`,
    priceCurrency: "VND",
    price: 790_000,
    availability: "https://schema.org/OutOfStock",
  });

  const addToBag = page.getByRole("button", { name: "Thêm vào giỏ hàng" });
  await expect(addToBag).toBeDisabled();
  await page.getByText(componentName, { exact: true }).click();
  await expect(page.getByRole("radio", { name: componentName })).toBeChecked();
  await expect(page.getByRole("group", { name: "Màu" })).toHaveCount(0);
  await page.getByText("M", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "M" })).toBeChecked();
  await expect(addToBag).toBeEnabled();
  await assertPageQuality(page);

  await addToBag.click();
  await expect(page.getByRole("status")).toContainText("Đã thêm sản phẩm vào giỏ hàng.");

  await page.goto(`${BASE_URL}/cart`, { waitUntil: "networkidle" });
  const cartLine = page.getByRole("article");
  await expect(cartLine.getByRole("heading", { name: componentName })).toBeVisible();
  await expect(page.getByRole("link", { name: componentName })).toHaveCount(0);
  await expect(cartLine.getByText("M", { exact: true })).toBeVisible();
  await expect(cartLine.getByText(/390\.000.*₫/)).toBeVisible();
  await assertPageQuality(page);

  const checkoutLink = page.getByRole("link", { name: "Tiến hành đặt hàng" });
  await expect(checkoutLink).toBeVisible();
  await checkoutLink.click();
  await expect(page).toHaveURL(`${BASE_URL}/checkout`);
  await expect(page.getByRole("heading", { level: 1, name: "THANH TOÁN" })).toBeVisible();
  await assertPageQuality(page);

  expect(
    await commerceService.setVariantActivation(adminSession, componentProductId, {
      variantIds: [componentVariantId],
      isActive: false,
    }),
  ).toEqual({
    ok: true,
    variantIds: [componentVariantId],
    isActive: false,
  });

  await page.goto(`${BASE_URL}/shop/${parentSlug}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("radio", { name: "Set" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: componentName })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Thêm vào giỏ hàng" })).toBeDisabled();

  expect(browserErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});

test("a set whose own Pancake stock is zero is offered once its components can supply it", async ({ page }) => {
  await prisma.compositeComponentMirror.update({
    where: {
      parentVariantId_componentVariantId: { parentVariantId, componentVariantId },
    },
    data: { quantity: 1 },
  });
  try {
    await page.goto(`${BASE_URL}/shop/${parentSlug}`, { waitUntil: "networkidle" });
    // The component is inactive for standalone sale again, but it still supplies the set.
    await expect(page.getByRole("radio", { name: componentName })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "Set" })).toBeEnabled();
  } finally {
    await prisma.compositeComponentMirror.update({
      where: {
        parentVariantId_componentVariantId: { parentVariantId, componentVariantId },
      },
      data: { quantity: 3 },
    });
  }
});
