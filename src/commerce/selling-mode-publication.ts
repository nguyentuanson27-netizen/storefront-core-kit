/**
 * What the machine-facing publishers may state about a variant's stock under its selling policy
 * (selling modes spec §9): the Merchant feed and product JSON-LD.
 *
 * One rule for both, so the two public consumers keep publishing one truth (the Merchant ↔ JSON-LD
 * convergence contract, `docs/audits/merchant-jsonld-parity.md`):
 *
 * - **`STANDARD`** (every product while `SELLING_MODES_ENABLED` is off) is exactly the rule both
 *   publishers used before selling modes: a negative or non-finite mirrored row makes availability
 *   unresolved, and the stock is the raw row sum minus local holds.
 * - **`OVERSELL` / `PREORDER`**: negative rows are the expected state, not a defect. Only a
 *   non-finite row is unresolved. The stated stock is the storefront's advisory `sellableUnits`
 *   (`max(0, free − floor)` on the floored sum), so "the customer can actually buy" is the feed truth.
 * - A **preorder sale** (`PREORDER`, sellable ≥ 1, ready < 1) has no truthful availability until
 *   Preorder truth v1 supplies an availability date: Merchant excludes it
 *   (`PREORDER_PROJECTION_PENDING`) and JSON-LD omits its offer.
 * - An **invalid policy** sells nothing and states nothing: unresolved.
 */

import { wholeMirroredUnits } from "./capacity-resources.ts";
import type { EffectiveSellingPolicy } from "./selling-policy.ts";

export type PublishableVariantStock = Readonly<{
  /** The stock a publisher classifies; `NaN` when availability cannot be stated. */
  stockQuantity: number;
  /** The variant is a preorder sale: no availability may be published for it in v1. */
  preorderProjectionPending: boolean;
}>;

const UNRESOLVED: PublishableVariantStock = Object.freeze({ stockQuantity: Number.NaN, preorderProjectionPending: false });

export function resolvePublishableVariantStock(
  quantities: readonly number[],
  heldUnits: number,
  policy: EffectiveSellingPolicy,
): PublishableVariantStock {
  if (policy.kind === "REFUSE") return UNRESOLVED;
  if (policy.mode === "STANDARD") {
    if (quantities.some((quantity) => !Number.isFinite(quantity) || quantity < 0)) return UNRESOLVED;
    return Object.freeze({
      stockQuantity: quantities.reduce((total, quantity) => total + quantity, 0) - heldUnits,
      preorderProjectionPending: false,
    });
  }

  const mirrored = wholeMirroredUnits(quantities);
  if (mirrored === null) return UNRESOLVED;
  const free = mirrored - heldUnits;
  const sellable = Math.max(0, free - policy.floor);
  return Object.freeze({
    stockQuantity: sellable,
    preorderProjectionPending: policy.mode === "PREORDER" && sellable >= 1 && free < 1,
  });
}

/**
 * Whether JSON-LD may state an availability for this variant from its mirrored rows at all: the
 * row-level half of the rule above, decided before holds and before the shopper-facing projection.
 */
export function isVariantAvailabilityPublishable(
  quantities: readonly number[],
  policy: EffectiveSellingPolicy,
): boolean {
  if (policy.kind === "REFUSE") return false;
  if (policy.mode === "STANDARD") return quantities.every((quantity) => Number.isFinite(quantity) && quantity >= 0);
  return quantities.every((quantity) => Number.isFinite(quantity));
}
