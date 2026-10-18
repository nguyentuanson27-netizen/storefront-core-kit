/**
 * Persistence for the optional size-guide chart images (B06; design approved in
 * docs/approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md). The only module that reads or
 * writes `SizeGuideMedia`. Callers hand it values already validated by `parseSizeGuideMediaInput`.
 */

import type { Prisma } from "../generated/prisma/client.ts";

import type { SizeGuideMedia } from "./size-guide-media.ts";

type Client = Pick<Prisma.TransactionClient, "sizeGuideMedia">;

/** Every stored row. Bounded by the number of configured charts, which is small by construction. */
export async function listSizeGuideMedia(client: Client): Promise<SizeGuideMedia[]> {
  return client.sizeGuideMedia.findMany({
    orderBy: { guideKey: "asc" },
    take: 64,
    select: { guideKey: true, imageUrl: true, altText: true, width: true, height: true },
  });
}

export async function saveSizeGuideMedia(
  client: Client,
  media: SizeGuideMedia,
  updatedByUserId: string | null,
): Promise<void> {
  const { guideKey, ...fields } = media;
  await client.sizeGuideMedia.upsert({
    where: { guideKey },
    create: { guideKey, ...fields, updatedByUserId },
    update: { ...fields, updatedByUserId },
  });
}

export async function removeSizeGuideMedia(client: Client, guideKey: string): Promise<void> {
  await client.sizeGuideMedia.deleteMany({ where: { guideKey } });
}
