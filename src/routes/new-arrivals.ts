import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  computeNewArrivalsPaging,
  parseNewArrivalsPage,
} from "@/commerce/new-arrivals-paging";
import {
  countNewArrivalsSelection,
  readNewArrivalsPageProductIds,
} from "@/commerce/new-arrivals-selection-repository";
import { listConfiguredStorefrontProductsByIds } from "@/commerce/storefront-catalog-runtime";
import { buildProductListTracking } from "@/components/analytics/product-list-tracking";
import { prisma } from "@/db/prisma";

import { sealRoute, type RouteHandle } from "./core.tsx";
import {
  NEW_ARRIVALS_LIST_ID,
  NEW_ARRIVALS_LIST_NAME,
  NEW_ARRIVALS_OFF_VIEW_MODEL,
  buildNewArrivalsViewModel,
  readNewArrivalsCurationEnabled,
  type NewArrivalsViewModel,
} from "./new-arrivals-model.ts";

export type { NewArrivalsViewModel } from "./new-arrivals-model.ts";

/**
 * The new-arrivals page's loader.
 *
 * With `NEW_ARRIVALS_CURATION_ENABLED` off (the default) the page is the editorial drop
 * announcement it has always been: this function touches neither the query string nor the database,
 * and the view model carries nothing. With it on, the page lists the administrator's curated
 * selection, paginated over stored slots, through the same catalog projection `/shop` uses.
 *
 * `connection()` runs first in both modes: the flag is a runtime environment value, and a page
 * prerendered at build time would bake the build-time answer in.
 */

export type NewArrivalsRouteProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export async function loadNewArrivalsRoute({
  searchParams,
}: NewArrivalsRouteProps): Promise<RouteHandle<NewArrivalsViewModel>> {
  await connection();

  if (!readNewArrivalsCurationEnabled()) {
    return sealRoute({
      data: NEW_ARRIVALS_OFF_VIEW_MODEL,
      // Nothing here is promotion-priced, so it re-reads on the shared default cadence.
      refreshAfterMs: 60_000,
      trackingEvent: null,
      structuredData: [],
      pixelEvents: [],
    });
  }

  const parsed = parseNewArrivalsPage((await searchParams).page);
  // A malformed or out-of-bound page is a bad URL, decided before any database read.
  if (!parsed.ok) notFound();

  const selectionCount = await countNewArrivalsSelection(prisma);
  const paging = computeNewArrivalsPaging(selectionCount, parsed.page);
  if (paging === null) notFound();

  const requestNow = new Date();
  const productIds = await readNewArrivalsPageProductIds(prisma, paging);
  const { products, pricingRule, refreshAfterMs } = await listConfiguredStorefrontProductsByIds({
    productIds,
    now: requestNow,
  });

  const listTracking = buildProductListTracking({
    products,
    list: { listId: NEW_ARRIVALS_LIST_ID, listName: NEW_ARRIVALS_LIST_NAME },
    pricingRule,
  });

  return sealRoute({
    data: buildNewArrivalsViewModel({
      products,
      page: parsed.page,
      totalPages: paging.totalPages,
      pricingRule,
      selectEventBySlug: listTracking.selectEventBySlug,
    }),
    refreshAfterMs,
    trackingEvent: listTracking.listEvent,
    structuredData: [],
    pixelEvents: [],
  });
}
