import assert from "node:assert/strict";
import test from "node:test";

import { BRAND } from "../../src/brand/index.ts";
import {
  acceptedAsPreorder,
  advisorySellableUnits,
  advisoryVariantCapacity,
  type CapacityResourceKind,
} from "../../src/commerce/capacity-resources.ts";
import { effectivePolicy, type SellingModeFlags } from "../../src/commerce/selling-policy.ts";
import { buildStorefrontCartLines } from "../../src/commerce/storefront-cart.ts";
import type { StorefrontVariantFacts } from "../../src/commerce/storefront-product.ts";
import { buildStorefrontProductProjection } from "../../src/commerce/storefront-projection.ts";
import { buildProductCardModel } from "../../src/components/headless/build-product-card-model.ts";
import { resolveVariantSelectionView } from "../../src/components/headless/variant-selection-model.ts";
import { buildCartViewModel } from "../../src/routes/cart-model.ts";
import { buildCheckoutViewModel } from "../../src/routes/checkout-model.ts";

/** Selling modes spec §8 (advisory read model) and §9 (surface semantics), M3. */

const ON: SellingModeFlags = { sellingModesEnabled: true, preorderEnabled: true };
const OFF: SellingModeFlags = { sellingModesEnabled: false, preorderEnabled: false };

function self(free: number | null) {
  return [{ kind: "SELF" as CapacityResourceKind, unitsPerLine: 1, fact: { mirroredUnits: free, activeReservedUnits: 0 } }];
}

function capacity(mode: string | null, free: number | null, flags = ON) {
  const policy = effectivePolicy(mode === null ? null : { sellingMode: mode, negativeStockLimit: -20 }, flags);
  const { sellableUnits, readyUnits, isPreorderSale } = advisoryVariantCapacity(self(free), policy);
  return [sellableUnits, readyUnits, isPreorderSale];
}

test("sellable / ready / isPreorderSale truth table across modes and stock (limit −20)", () => {
  // [free]          STANDARD              OVERSELL                PREORDER
  const rows: [number, unknown[], unknown[], unknown[]][] = [
    [5, [5, 5, false], [25, 5, false], [25, 5, false]],
    [0, [0, 0, false], [20, 0, false], [20, 0, true]],
    [-3, [0, 0, false], [17, 0, false], [17, 0, true]],
    [-19, [0, 0, false], [1, 0, false], [1, 0, true]],
    [-20, [0, 0, false], [0, 0, false], [0, 0, false]],
    [-25, [0, 0, false], [0, 0, false], [0, 0, false]],
  ];
  for (const [free, standard, oversell, preorder] of rows) {
    assert.deepEqual(capacity("STANDARD", free), standard, `STANDARD ${free}`);
    assert.deepEqual(capacity("OVERSELL", free), oversell, `OVERSELL ${free}`);
    assert.deepEqual(capacity("PREORDER", free), preorder, `PREORDER ${free}`);
    // No row is STANDARD.
    assert.deepEqual(capacity(null, free), standard, `no row ${free}`);
  }
});

test("with the flags off every mode reads exactly as STANDARD, which is exactly the old advisory figure", () => {
  for (const free of [5, 0, -3]) {
    for (const mode of ["OVERSELL", "PREORDER"]) {
      assert.deepEqual(capacity(mode, free, OFF), capacity("STANDARD", free), `${mode} ${free}`);
    }
    assert.equal(capacity("STANDARD", free, OFF)[0], advisorySellableUnits(self(free)));
  }
  // A stored PREORDER with only the capability on sells as STANDARD and is never a preorder.
  assert.deepEqual(capacity("PREORDER", 0, { sellingModesEnabled: true, preorderEnabled: false }), [0, 0, false]);
});

test("invalid policy, untrusted mirror and unprovable topology offer nothing", () => {
  const invalid = effectivePolicy({ sellingMode: "OVERSELL", negativeStockLimit: 7 }, ON);
  assert.deepEqual(advisoryVariantCapacity(self(4), invalid), {
    sellableUnits: 0,
    readyUnits: 4,
    isPreorderSale: false,
    acceptsPreorder: false,
  });
  assert.equal(advisoryVariantCapacity(self(null), effectivePolicy(null, ON)).sellableUnits, 0);
  assert.equal(advisoryVariantCapacity(null, effectivePolicy(null, ON)).sellableUnits, 0);
});

test("a composite parent sells whole sets at component floor 0, and nothing under a non-STANDARD mode", () => {
  const components = [
    { kind: "COMPONENT" as CapacityResourceKind, unitsPerLine: 1, fact: { mirroredUnits: 4, activeReservedUnits: 0 } },
    { kind: "COMPONENT" as CapacityResourceKind, unitsPerLine: 2, fact: { mirroredUnits: -3, activeReservedUnits: 0 } },
  ];
  assert.equal(advisoryVariantCapacity(components, effectivePolicy(null, ON)).sellableUnits, 0);
  const healthy = [components[0]!];
  assert.equal(advisoryVariantCapacity(healthy, effectivePolicy(null, ON)).sellableUnits, 4);
  assert.equal(
    advisoryVariantCapacity(healthy, effectivePolicy({ sellingMode: "OVERSELL", negativeStockLimit: -20 }, ON)).sellableUnits,
    0,
  );
});

test("preorder classification is quantity-aware: 1 ready + buy 2 is a preorder line, 2 ready + buy 2 is not", () => {
  const oneReady = advisoryVariantCapacity(self(1), effectivePolicy({ sellingMode: "PREORDER", negativeStockLimit: -20 }, ON));
  assert.equal(oneReady.sellableUnits, 21);
  assert.equal(oneReady.isPreorderSale, false, "the next single unit is ready: no card/PDP marker");
  assert.equal(acceptedAsPreorder(1, oneReady), false);
  assert.equal(acceptedAsPreorder(2, oneReady), true);

  const twoReady = advisoryVariantCapacity(self(2), effectivePolicy({ sellingMode: "PREORDER", negativeStockLimit: -20 }, ON));
  assert.equal(acceptedAsPreorder(2, twoReady), false);
  // OVERSELL is never a preorder, however far below zero it sells.
  const oversell = advisoryVariantCapacity(self(-5), effectivePolicy({ sellingMode: "OVERSELL", negativeStockLimit: -20 }, ON));
  assert.equal(acceptedAsPreorder(3, oversell), false);
  // A variant without the advisory fields never is either.
  assert.equal(acceptedAsPreorder(3, {}), false);
});

function facts(id: string, size: string, fields: Partial<StorefrontVariantFacts>): StorefrontVariantFacts {
  return {
    id,
    pancakeVariationId: `pancake-${id}`,
    color: "Black",
    size,
    sellableStock: 0,
    retailPrice: 500_000,
    retailPriceAfterDiscount: 500_000,
    ...fields,
  };
}

const PREORDER_SALE = { sellableStock: 20, readyUnits: 0, isPreorderSale: true, acceptsPreorder: true };
const PREORDER_ONE_READY = { sellableStock: 21, readyUnits: 1, isPreorderSale: false, acceptsPreorder: true };
const OVERSELL_BELOW_ZERO = { sellableStock: 17, readyUnits: 0, isPreorderSale: false, acceptsPreorder: false };

test("card: marked only when every sellable variant is a preorder sale", () => {
  const card = (variants: StorefrontVariantFacts[]) => buildProductCardModel({ slug: "tee", name: "Tee", variants }).isPreorder;
  assert.equal(card([facts("s", "S", PREORDER_SALE), facts("m", "M", PREORDER_SALE)]), true);
  assert.equal(card([facts("s", "S", PREORDER_SALE), facts("m", "M", { sellableStock: 0 })]), true, "sold-out siblings do not count");
  assert.equal(card([facts("s", "S", PREORDER_SALE), facts("m", "M", { sellableStock: 3, readyUnits: 3 })]), false);
  assert.equal(card([facts("s", "S", PREORDER_ONE_READY)]), false, "1 ready: the card shows no marker");
  assert.equal(card([facts("s", "S", OVERSELL_BELOW_ZERO)]), false, "OVERSELL below zero has no marker");
  assert.equal(card([facts("s", "S", { sellableStock: 0 })]), false);
});

test("PDP: the selected preorder-sale option shows the brand marker next to the availability text", () => {
  const projection = buildStorefrontProductProjection({
    parentVariants: [facts("s", "S", PREORDER_SALE), facts("m", "M", PREORDER_ONE_READY)],
    componentGroups: [],
    hasCompositeGraph: false,
  });
  const view = (size: string, preorderLabel: string | undefined = BRAND.copy.preorderLabel) =>
    resolveVariantSelectionView({
      options: projection.options,
      productLevelOptions: projection.options,
      selection: { kindKey: null, color: "Black", size },
      preorderLabel,
    });
  assert.equal(view("S").canAdd, true, "a preorder sale is purchasable");
  assert.equal(view("S").preorderMessage, BRAND.copy.preorderLabel);
  assert.equal(view("M").preorderMessage, "", "1 ready: no marker on the option");
  assert.equal(view("S", undefined).preorderMessage, BRAND.copy.preorderLabel);
});

test("cart and checkout: a line is marked whenever its quantity runs past the ready units", () => {
  const product = {
    slug: "tee",
    pancakeProductId: "pancake-tee",
    name: "Tee",
    isPresent: true,
    isActive: true,
    variants: [
      { ...facts("ready1", "S", PREORDER_ONE_READY), isPresent: true, isActive: true },
      { ...facts("over", "M", OVERSELL_BELOW_ZERO), isPresent: true, isActive: true },
    ],
  };
  const lines = buildStorefrontCartLines({
    items: [
      { variantId: "ready1", quantity: 2 },
      { variantId: "over", quantity: 2 },
    ],
    products: [product],
  });
  assert.equal(lines[0]!.isPreorder, true, "1 ready + buy 2");
  assert.equal("isPreorder" in lines[1]!, false, "OVERSELL is never marked");
  assert.ok(lines.every((line) => line.available));

  const single = buildStorefrontCartLines({ items: [{ variantId: "ready1", quantity: 1 }], products: [product] });
  assert.equal("isPreorder" in single[0]!, false, "1 ready + buy 1 is not a preorder");

  const cart = buildCartViewModel({ lines, commerceTrackingEnabled: false, preorderLabel: "Pre" });
  assert.deepEqual(cart.lines.map((line) => line.preorderMarker), ["Pre", null]);
  assert.deepEqual(
    buildCartViewModel({ lines, commerceTrackingEnabled: false }).lines.map((line) => line.preorderMarker),
    [BRAND.copy.preorderLabel, null],
    "defaults to the brand copy key",
  );

  const checkout = buildCheckoutViewModel({
    lines,
    totals: {
      items: [
        { variantExternalId: "pancake-ready1", quantity: 2, unitPriceVnd: 500_000 },
        { variantExternalId: "pancake-over", quantity: 2, unitPriceVnd: 500_000 },
      ],
      merchandiseSubtotalVnd: 2_000_000,
      shippingFeeVnd: 0,
      totalVnd: 2_000_000,
      totalQuantity: 4,
    },
    quoteProof: "proof",
  });
  assert.deepEqual(checkout.lines.map((line) => line.preorderMarker), [BRAND.copy.preorderLabel, null]);
});

test("the preorder marker text is the brand copy key, never a hardcoded string", () => {
  assert.equal(typeof BRAND.copy.preorderLabel, "string");
  assert.ok(BRAND.copy.preorderLabel.length > 0);
});
