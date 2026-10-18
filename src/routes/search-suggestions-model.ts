import type { StorefrontProductMedia, TrustedProductImage } from "../commerce/product-media.ts";
import { buildStorefrontDiscoveryHref } from "../commerce/storefront-discovery.ts";
import {
  readStorefrontSearchSuggestionsEnabled,
  type StorefrontSearchSuggestionCandidates,
  type StorefrontSearchSuggestionFailure,
} from "../commerce/storefront-search-suggestions.ts";
import type {
  StorefrontPricingRule,
  StorefrontVariantFacts,
} from "../commerce/storefront-product.ts";
import { buildProductCardModel } from "../components/headless/build-product-card-model.ts";

/**
 * What the browser is told about search suggestions, as one pure function.
 *
 * Every field is derived by the same code that renders a `/shop` card, so a suggestion cannot show
 * a price, a badge or an availability the listing would not. The shape is deliberately narrow: a
 * public slug-based link, a trusted image, formatted prices and an availability word. No internal
 * product or variant id, no raw price, no promotion deadline and no stock count leaves the server.
 */

export type SearchSuggestionProduct = Readonly<{
  slug: string;
  name: string;
  media?: StorefrontProductMedia | null;
  variants: readonly StorefrontVariantFacts[];
}>;

export type SearchSuggestionItem = Readonly<{
  /** The product's public slug; unique within one response, so it is the render key. */
  key: string;
  name: string;
  /** The canonical PDP path from the card model. */
  href: string;
  image: TrustedProductImage | null;
  priceText: string;
  compareAtText: string | null;
  availability: "in-stock" | "out-of-stock" | "partial";
}>;

export type SearchSuggestionsModel =
  | Readonly<{
      ok: true;
      query: string;
      items: readonly SearchSuggestionItem[];
      /** The canonical `/shop` listing for the same query: the no-JS and "see all" destination. */
      seeAllHref: string;
      totalCount: number;
      /** How many matches the suggestion list leaves out; 0 when it shows them all. */
      remainingCount: number;
    }>
  | Readonly<{ ok: false; reason: StorefrontSearchSuggestionFailure }>;

export function buildSearchSuggestionsModel(
  candidates: StorefrontSearchSuggestionCandidates<SearchSuggestionProduct>,
  pricingRule?: StorefrontPricingRule,
): SearchSuggestionsModel {
  if (!candidates.ok) return Object.freeze({ ok: false, reason: candidates.reason });

  const seen = new Set<string>();
  const items: SearchSuggestionItem[] = [];
  for (const product of candidates.products) {
    // A repeated slug would be a repeated render key and a duplicated suggestion.
    if (seen.has(product.slug)) continue;
    seen.add(product.slug);

    const card = buildProductCardModel({
      slug: product.slug,
      name: product.name,
      media: product.media,
      variants: product.variants,
      pricingRule,
    });
    items.push(
      Object.freeze({
        key: product.slug,
        name: card.name,
        href: card.href,
        image: card.primaryImage,
        priceText: card.price.displayText,
        compareAtText: card.price.compareAtText,
        availability: card.availability,
      }),
    );
  }

  return Object.freeze({
    ok: true,
    query: candidates.query,
    items: Object.freeze(items),
    seeAllHref: buildStorefrontDiscoveryHref(candidates.discovery, 1),
    totalCount: candidates.totalCount,
    remainingCount: Math.max(candidates.totalCount - items.length, 0),
  });
}

/**
 * Strictly `"true"` turns the search overlay on, and only while search suggestions are on too: an
 * overlay with nothing to suggest would open onto an error. Anything else, including unset, is OFF.
 */
export function readSearchOverlayEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.SEARCH_OVERLAY_ENABLED === "true" && readStorefrontSearchSuggestionsEnabled(env);
}
