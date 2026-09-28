import assert from "node:assert/strict";
import test from "node:test";

import { classifyMerchantAvailability } from "../../src/commerce/merchant-identity-audit.ts";
import { effectivePolicy, type SellingModeFlags } from "../../src/commerce/selling-policy.ts";
import {
  isVariantAvailabilityPublishable,
  resolvePublishableVariantStock,
} from "../../src/commerce/selling-mode-publication.ts";

/** Selling modes spec §9: what the Merchant feed and JSON-LD may state under each mode. */

const ON: SellingModeFlags = { sellingModesEnabled: true, preorderEnabled: true };
const OFF: SellingModeFlags = { sellingModesEnabled: false, preorderEnabled: false };
const policy = (sellingMode: string | null, flags = ON, negativeStockLimit = -20) =>
  effectivePolicy(sellingMode === null ? null : { sellingMode, negativeStockLimit }, flags);

function publish(rows: number[], mode: string | null, { held = 0, flags = ON } = {}) {
  const { stockQuantity, preorderProjectionPending } = resolvePublishableVariantStock(rows, held, policy(mode, flags));
  return [classifyMerchantAvailability(stockQuantity), preorderProjectionPending];
}

test("STANDARD (and every mode with the capability off) is exactly the pre-selling-modes rule", () => {
  for (const [mode, flags] of [[null, ON], ["STANDARD", ON], ["OVERSELL", OFF], ["PREORDER", OFF]] as const) {
    assert.deepEqual(publish([3], mode, { flags }), ["IN_STOCK", false]);
    assert.deepEqual(publish([0], mode, { flags }), ["OUT_OF_STOCK", false]);
    assert.deepEqual(publish([5, -3], mode, { flags }), ["AVAILABILITY_UNRESOLVED", false], "a negative row is a defect");
    assert.deepEqual(publish([2], mode, { held: 3, flags }), ["AVAILABILITY_UNRESOLVED", false]);
    assert.deepEqual(publish([Number.NaN], mode, { flags }), ["AVAILABILITY_UNRESOLVED", false]);
    assert.equal(isVariantAvailabilityPublishable([5, -3], policy(mode, flags)), false);
    assert.equal(isVariantAvailabilityPublishable([5, 0], policy(mode, flags)), true);
  }
});

test("OVERSELL: negative stock is the expected state; the feed states what can still be bought", () => {
  assert.deepEqual(publish([-3], "OVERSELL"), ["IN_STOCK", false]);
  assert.equal(resolvePublishableVariantStock([-3], 0, policy("OVERSELL")).stockQuantity, 17);
  assert.deepEqual(publish([-19], "OVERSELL"), ["IN_STOCK", false]);
  assert.deepEqual(publish([-20], "OVERSELL"), ["OUT_OF_STOCK", false], "at the limit nothing more may be sold");
  assert.deepEqual(publish([-25], "OVERSELL"), ["OUT_OF_STOCK", false]);
  assert.deepEqual(publish([-10], "OVERSELL", { held: 10 }), ["OUT_OF_STOCK", false], "holds count toward the limit");
  assert.deepEqual(publish([Number.POSITIVE_INFINITY], "OVERSELL"), ["AVAILABILITY_UNRESOLVED", false]);
  assert.equal(isVariantAvailabilityPublishable([5, -3], policy("OVERSELL")), true);
  assert.equal(isVariantAvailabilityPublishable([Number.NaN], policy("OVERSELL")), false);
});

test("PREORDER: a preorder sale is pending; with ready stock it publishes like OVERSELL", () => {
  assert.deepEqual(publish([0], "PREORDER")[1], true);
  assert.deepEqual(publish([-5], "PREORDER")[1], true);
  assert.deepEqual(publish([1], "PREORDER"), ["IN_STOCK", false], "the next unit is ready");
  assert.deepEqual(publish([-20], "PREORDER"), ["OUT_OF_STOCK", false], "at the limit: not a sale at all");
  // The preorder flag off makes the same row STANDARD.
  assert.deepEqual(publish([0], "PREORDER", { flags: { sellingModesEnabled: true, preorderEnabled: false } }), [
    "OUT_OF_STOCK",
    false,
  ]);
});

test("an invalid stored policy states nothing, under every flag combination", () => {
  for (const flags of [ON, OFF]) {
    const invalid = effectivePolicy({ sellingMode: "OVERSELL", negativeStockLimit: 3 }, flags);
    assert.equal(Number.isNaN(resolvePublishableVariantStock([5], 0, invalid).stockQuantity), true);
    assert.equal(isVariantAvailabilityPublishable([5], invalid), false);
  }
});
