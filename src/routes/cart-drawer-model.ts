import type { TrustedProductImage } from "../commerce/product-media.ts";
import type { CartViewModel } from "./cart-model.ts";

/**
 * What the cart drawer is told about the shopper's cart, derived from the cart route's own model.
 *
 * The drawer is a read-only summary. Every figure here -- the line prices, the availability words,
 * the subtotal, whether checkout is offered -- is what `buildCartViewModel` already decided for
 * `/cart`, passed through rather than recomputed, so the drawer and the cart page cannot disagree.
 * Editing a quantity stays on `/cart`, where the canonical cart mutation and its feedback live.
 *
 * The shape is deliberately narrower than `CartViewModel`: no `variantId` (an internal mutation
 * identity the drawer has no use for) and no tracking flag.
 */

export type CartDrawerLine = Readonly<{
  /** Position-based and unique within one response; the render key. */
  key: string;
  productName: string;
  /** The canonical PDP path, or `null` when the product is no longer in the catalog. */
  href: string | null;
  image: TrustedProductImage | null;
  optionLabel: string;
  quantity: number;
  priceText: string;
  available: boolean;
  availabilityLabel: string;
  preorderMarker: string | null;
}>;

export type CartDrawerView = Readonly<{
  isEmpty: boolean;
  lines: readonly CartDrawerLine[];
  subtotalText: string;
  hasUnavailableLines: boolean;
  canCheckout: boolean;
}>;

export function buildCartDrawerView(cart: CartViewModel): CartDrawerView {
  return Object.freeze({
    isEmpty: cart.isEmpty,
    lines: Object.freeze(
      cart.lines.map((line, index) =>
        Object.freeze({
          key: `line-${index}`,
          productName: line.productName,
          href: line.productSlug === null ? null : `/shop/${line.productSlug}`,
          image: line.primaryImage,
          optionLabel: line.optionLabel,
          quantity: line.quantity,
          priceText: line.priceText,
          available: line.available,
          availabilityLabel: line.availabilityLabel,
          preorderMarker: line.preorderMarker,
        }),
      ),
    ),
    subtotalText: cart.subtotalText,
    hasUnavailableLines: cart.hasUnavailableLines,
    canCheckout: cart.canCheckout,
  });
}

/** Strictly `"true"` turns the cart drawer on; anything else, including unset, is OFF. */
export function readCartDrawerEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.CART_DRAWER_ENABLED === "true";
}
