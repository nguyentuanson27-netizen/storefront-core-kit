import { connection } from "next/server";

import {
  readSizeGuideMediaEnabled,
  selectRenderableSizeGuideMedia,
} from "@/commerce/size-guide-media";
import { listSizeGuideMedia } from "@/commerce/size-guide-media-repository";
import { prisma } from "@/db/prisma";

import { buildSizeGuideViewModel, type SizeGuideViewModel } from "./evergreen-model.ts";
import { sealRoute, type RouteHandle } from "./core.tsx";

/**
 * The Size Guide's loader. Every measurement it shows is an approved table, read from config.
 *
 * With `SIZE_GUIDE_MEDIA_ENABLED` off (the default) the table of images is never read and `media` is
 * empty, so the page is what it has always been. On, a chart may carry one trusted image beside its
 * approved table; the image never replaces or alters a measurement. `connection()` runs first in both
 * modes because the flag is a runtime environment value.
 */

export type SizeGuideRouteProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export type SizeGuideChartMedia = Readonly<{ url: string; alt: string; width: number; height: number }>;

/** The pure facts plus the optional chart images, keyed by chart id. */
export type SizeGuideRouteViewModel = SizeGuideViewModel &
  Readonly<{ media: Readonly<Record<string, SizeGuideChartMedia>> }>;

export async function loadSizeGuideRoute(): Promise<RouteHandle<SizeGuideRouteViewModel>> {
  await connection();

  const facts = buildSizeGuideViewModel();
  const media: Record<string, SizeGuideChartMedia> = {};
  if (readSizeGuideMediaEnabled()) {
    const known = facts.charts.map((chart) => chart.id);
    const rows = await listSizeGuideMedia(prisma);
    for (const [guideKey, row] of selectRenderableSizeGuideMedia(rows, known)) {
      media[guideKey] = Object.freeze({ url: row.imageUrl, alt: row.altText, width: row.width, height: row.height });
    }
  }

  return sealRoute({
    data: Object.freeze({ ...facts, media: Object.freeze(media) }),
    // Nothing here is promotion-priced, so it re-reads on the shared default cadence.
    refreshAfterMs: 60_000,
    trackingEvent: null,
    structuredData: [],
    pixelEvents: [],
  });
}
