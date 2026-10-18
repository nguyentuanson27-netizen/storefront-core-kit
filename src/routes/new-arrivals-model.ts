import {
  NEW_ARRIVALS_PAGE_SIZE,
  newArrivalsPagePath,
} from "../commerce/new-arrivals-paging.ts";
import type { StorefrontProductMedia } from "../commerce/product-media.ts";
import type {
  StorefrontPricingRule,
  StorefrontVariantFacts,
} from "../commerce/storefront-product.ts";
import {
  buildProductCardModel,
  type ProductCardModel,
} from "../components/headless/build-product-card-model.ts";
import type { TrackingEvent } from "../tracking/commerce-events.ts";

/**
 * Everything the curated new-arrivals listing decides, as one pure function (B03).
 *
 * Separate from `new-arrivals.ts` because that file reaches the catalog runtime, `next/server` and
 * `notFound()`. The card model is the one `/shop` builds, so price, availability, media and the PDP
 * link come from the same projection and there is no second catalog authority.
 */

export const NEW_ARRIVALS_LIST_ID = "new-arrivals";
export const NEW_ARRIVALS_LIST_NAME = "Hàng mới";

/** Strictly `"true"` turns the curated listing on; anything else, including unset, is OFF. */
export function readNewArrivalsCurationEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.NEW_ARRIVALS_CURATION_ENABLED === "true";
}

export type NewArrivalsProduct = Readonly<{
  id: string;
  slug: string;
  name: string;
  media?: StorefrontProductMedia | null;
  variants: StorefrontVariantFacts[];
}>;

export type NewArrivalsCurated = Readonly<{
  cards: readonly Readonly<{ id: string; model: ProductCardModel }>[];
  /** Index of the first stored slot on this page, so the tone cycle continues across pages. */
  toneOffset: number;
  page: number;
  /** Pages of *stored slots*; hidden products do not change it. */
  totalPages: number;
  previousHref: string | null;
  nextHref: string | null;
  /**
   * True when this page shows no card: an empty selection, or a page whose stored slots are all
   * hidden. The page keeps its editorial frame and says so in an accessible status.
   */
  empty: boolean;
}>;

/** `curated` is null when the feature is OFF; the page then renders exactly what it always has. */
export type NewArrivalsViewModel = Readonly<{ curated: NewArrivalsCurated | null }>;

export const NEW_ARRIVALS_OFF_VIEW_MODEL: NewArrivalsViewModel = Object.freeze({ curated: null });

export type NewArrivalsCuratedInput = Readonly<{
  /** Already in stored order; products hidden or gone are absent, with no replacement. */
  products: readonly NewArrivalsProduct[];
  page: number;
  totalPages: number;
  pricingRule?: StorefrontPricingRule;
  selectEventBySlug: ReadonlyMap<string, TrackingEvent>;
}>;

export function buildNewArrivalsViewModel(input: NewArrivalsCuratedInput): NewArrivalsViewModel {
  const cards = Object.freeze(
    input.products.map((product) =>
      Object.freeze({
        id: product.id,
        model: buildProductCardModel({
          slug: product.slug,
          name: product.name,
          media: product.media,
          variants: product.variants,
          pricingRule: input.pricingRule,
          selectEvent: input.selectEventBySlug.get(product.slug) ?? null,
        }),
      }),
    ),
  );

  return Object.freeze({
    curated: Object.freeze({
      cards,
      toneOffset: (input.page - 1) * NEW_ARRIVALS_PAGE_SIZE,
      page: input.page,
      totalPages: input.totalPages,
      previousHref: input.page > 1 ? newArrivalsPagePath(input.page - 1) : null,
      nextHref: input.page < input.totalPages ? newArrivalsPagePath(input.page + 1) : null,
      empty: cards.length === 0,
    }),
  });
}
