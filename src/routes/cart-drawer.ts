"use server";

import { getCurrentStorefrontCartLines } from "@/commerce/storefront-cart-runtime";
import { isCommerceTrackingEnabled } from "@/components/analytics/commerce-event-reporter";

import { buildCartDrawerView, readCartDrawerEnabled, type CartDrawerView } from "./cart-drawer-model.ts";
import { buildCartViewModel } from "./cart-model.ts";

/**
 * The cart drawer's one read: the current shopper's cart, as the narrow `CartDrawerView`.
 *
 * Read-only and cookie-scoped like `/cart` itself -- it resolves the shopper's own anonymous cart
 * and nothing else. With `CART_DRAWER_ENABLED` off it answers `null` without touching the database,
 * so a deployment that never enables the drawer pays nothing for the endpoint existing.
 */
export async function readStorefrontCartDrawer(): Promise<CartDrawerView | null> {
  if (!readCartDrawerEnabled()) return null;
  const lines = await getCurrentStorefrontCartLines();
  return buildCartDrawerView(
    buildCartViewModel({ lines, commerceTrackingEnabled: isCommerceTrackingEnabled() }),
  );
}
