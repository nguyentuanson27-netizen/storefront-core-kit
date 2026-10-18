import type { Metadata } from "next";

import { BRAND } from "../../brand/index.ts";
import { parseNewArrivalsPage } from "../../commerce/new-arrivals-paging.ts";
import { readNewArrivalsCurationEnabled } from "../new-arrivals-model.ts";

/**
 * The new-arrivals page's metadata.
 *
 * Off (the default) it is byte-for-byte what it always was and `searchParams` is never read. On, a
 * page after the first says which page it is; nothing else changes. Indexation is deliberately not
 * touched: `/new-arrivals` is not an indexable listing path today, so no canonical is added here,
 * and a malformed page falls back to the base metadata (the route itself answers 404).
 */

export const NEW_ARRIVALS_TITLE = "Hàng mới";
const NEW_ARRIVALS_DESCRIPTION = `Những sản phẩm mới nhất từ ${BRAND.identity.name}.`;

export type NewArrivalsMetadataProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export function buildNewArrivalsBaseMetadata(): Metadata {
  return { title: NEW_ARRIVALS_TITLE, description: NEW_ARRIVALS_DESCRIPTION };
}

export async function buildNewArrivalsMetadata({
  searchParams,
}: NewArrivalsMetadataProps): Promise<Metadata> {
  if (!readNewArrivalsCurationEnabled()) return buildNewArrivalsBaseMetadata();

  const parsed = parseNewArrivalsPage((await searchParams).page);
  if (!parsed.ok || parsed.page === 1) return buildNewArrivalsBaseMetadata();
  return {
    title: `${NEW_ARRIVALS_TITLE} — Trang ${parsed.page}`,
    description: NEW_ARRIVALS_DESCRIPTION,
  };
}
