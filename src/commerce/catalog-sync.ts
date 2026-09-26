import type { PancakeParsedCatalogVariation } from "../integrations/pancake/catalog-contract.ts";
import { fetchAllPancakeCatalogVariations } from "../integrations/pancake/catalog-pages.ts";
import type { PancakeCompositeSnapshot } from "../integrations/pancake/composite-contract.ts";
import { fetchPancakeCompositeSnapshot } from "../integrations/pancake/composite-pages.ts";

type QueryValue = string | number | boolean;
type CatalogClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
};

type CatalogMirrorWriter = {
  syncSnapshot(input: {
    shopId: number;
    variations: readonly PancakeParsedCatalogVariation[];
    compositeSnapshot: PancakeCompositeSnapshot;
    syncedAt: Date;
  }): Promise<{ products: number; variations: number }>;
};

/**
 * Fetches the complete catalog and composite graph, then persists them as one mirror snapshot.
 *
 * The snapshot's `syncedAt` is sampled here, from `clock`, immediately before the first Pancake
 * request. A caller chooses the time source but cannot choose when it is read, so the stored marker
 * is always the instant this stock observation *started*. Capacity handoff depends on that: a read
 * that started after an order was accepted cannot have missed that order's stock effect, while one
 * that started before it can, however late its result lands (spec §5.4.2).
 */
export async function syncPancakeCatalog({
  client,
  repository,
  shopId,
  clock,
}: {
  client: CatalogClient;
  repository: CatalogMirrorWriter;
  shopId: number;
  clock: () => Date;
}) {
  const syncedAt = clock();
  const variations = await fetchAllPancakeCatalogVariations({ client, shopId });
  const compositeSnapshot = await fetchPancakeCompositeSnapshot({ client, shopId });
  return repository.syncSnapshot({ shopId, variations, compositeSnapshot, syncedAt });
}
