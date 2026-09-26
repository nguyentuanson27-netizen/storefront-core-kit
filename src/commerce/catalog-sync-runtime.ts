import { prisma } from "../db/prisma.ts";
import { PancakeClient } from "../integrations/pancake/client.ts";
import { readPancakeConfig } from "../integrations/pancake/config.ts";
import { createCatalogMirrorRepository } from "./catalog-mirror-repository.ts";
import { syncPancakeCatalog } from "./catalog-sync.ts";

export async function syncConfiguredPancakeCatalog({
  clock = () => new Date(),
}: {
  clock?: () => Date;
} = {}) {
  const config = readPancakeConfig();
  const client = new PancakeClient({ apiKey: config.apiKey });
  const repository = createCatalogMirrorRepository(prisma);

  return syncPancakeCatalog({
    client,
    repository,
    shopId: config.shopId,
    clock,
  });
}
