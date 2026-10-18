/**
 * The manual related-products override (B05): pure rules, no storage.
 *
 * A product's manual candidates are the administrator's choice; what the shopper sees is the first
 * few that are *currently visible*. The override only ever adds a source: when it yields nothing
 * (no rows, or none visible) the caller falls back to the collection-projected related products
 * that have always been used, so turning the feature on can never leave a product page with fewer
 * related products than it had.
 */

/** Owner-approved ceiling on stored candidates per product; a database CHECK enforces it too. */
export const RELATED_OVERRIDE_MAX_ITEMS = 8;
/** The product page's related section shows at most this many, as it always has. */
export const RELATED_OVERRIDE_DISPLAY_LIMIT = 4;

/** Strictly `"true"` turns the override on; anything else, including unset, is OFF. */
export function readRelatedOverrideEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.RELATED_PRODUCTS_OVERRIDE_ENABLED === "true";
}

/**
 * The candidates to show, from products already filtered to the visible ones and given in stored
 * order. Drops the current product and any repeat defensively (the schema already forbids both),
 * keeps the stored order, and stops at the display limit. A hidden candidate is simply absent from
 * `visible`, so the next stored candidate takes its place within this list — the one place a
 * "refill" is intended, because the section is a small recommendation rail, not a paginated list.
 */
export function selectRelatedOverride<T extends Readonly<{ id: string }>>(
  currentProductId: string,
  visible: readonly T[],
  limit: number = RELATED_OVERRIDE_DISPLAY_LIMIT,
): T[] {
  const seen = new Set<string>([currentProductId]);
  const chosen: T[] = [];
  for (const candidate of visible) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    chosen.push(candidate);
    if (chosen.length >= limit) break;
  }
  return chosen;
}
