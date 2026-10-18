/**
 * Persistence and lifecycle for benefit campaigns (A06; design approved in
 * docs/approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md).
 *
 * The only module that reads or writes the `BenefitCampaign*` tables. Lifecycle:
 *
 * - a campaign is created as a draft and may be redefined only while it has never been enabled
 *   (`enabledAt IS NULL`), guarded by an optimistic `version`;
 * - publishing is one transaction that takes a transaction-scoped advisory lock, re-reads every other
 *   enabled benefit campaign and every enabled legacy campaign, applies the accepted overlap rules
 *   (`findBenefitPublishConflicts`), and only then sets `isEnabled`, so two administrators cannot
 *   publish conflicting campaigns together;
 * - disabling is always allowed and never deletes anything.
 *
 * Residual, recorded rather than hidden: the legacy publish path does not take this advisory lock, so a
 * legacy campaign enabled *after* a benefit campaign is not checked against it at publish. The runtime
 * rules (A05) are the backstop: a legacy-discounted line never receives an A1 price benefit.
 */

import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";

import {
  findBenefitPublishConflicts,
  validateBenefitCampaignDraft,
  type BenefitCampaignDraft,
  type BenefitConflict,
  type BenefitDraftRefusal,
  type BenefitScopeFacts,
} from "./benefit-campaign.ts";

type ReadClient = Pick<Prisma.TransactionClient, "benefitCampaign">;

/** One fixed key for the publish lock. */
const PUBLISH_LOCK_KEY = "benefit-campaign-publish";

export type BenefitWriteRefusal =
  | BenefitDraftRefusal
  | "UNKNOWN_TARGET"
  | "UNKNOWN_GIFT"
  | "NOT_FOUND"
  | "STALE_VERSION"
  | "ALREADY_STARTED"
  | "ALREADY_ENABLED"
  | "WINDOW_ENDED"
  | "CONFLICT";

export type BenefitWriteResult =
  | Readonly<{ ok: true; id: string; version: number }>
  | Readonly<{ ok: false; reason: BenefitWriteRefusal; conflicts?: readonly BenefitConflict[] }>;

export type BenefitCampaignSummary = Readonly<{
  id: string;
  kind: string;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  isEnabled: boolean;
  enabledAt: Date | null;
  disabledAt: Date | null;
  version: number;
  tierCount: number;
  giftCount: number;
  targetCount: number;
}>;

/** The 100 most recently changed campaigns, newest first. Bounded. */
export async function listBenefitCampaigns(client: ReadClient): Promise<BenefitCampaignSummary[]> {
  const rows = await client.benefitCampaign.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      kind: true,
      name: true,
      startsAt: true,
      endsAt: true,
      isEnabled: true,
      enabledAt: true,
      disabledAt: true,
      version: true,
      _count: { select: { tiers: true, gifts: true, targets: true } },
    },
  });
  return rows.map(({ _count, ...row }) => ({
    ...row,
    tierCount: _count.tiers,
    giftCount: _count.gifts,
    targetCount: _count.targets,
  }));
}

async function checkReferences(
  tx: Prisma.TransactionClient,
  draft: BenefitCampaignDraft,
): Promise<"UNKNOWN_TARGET" | "UNKNOWN_GIFT" | null> {
  const productIds = draft.targets.flatMap((target) => ("productId" in target ? [target.productId] : []));
  const variantTargets = draft.targets.flatMap((target) => ("variantId" in target ? [target.variantId] : []));
  if (productIds.length > 0 && (await tx.productMirror.count({ where: { id: { in: productIds } } })) !== productIds.length) {
    return "UNKNOWN_TARGET";
  }
  if (variantTargets.length > 0 && (await tx.variantMirror.count({ where: { id: { in: variantTargets } } })) !== variantTargets.length) {
    return "UNKNOWN_TARGET";
  }
  const giftIds = draft.gifts.map((gift) => gift.variantId);
  if (giftIds.length > 0 && (await tx.variantMirror.count({ where: { id: { in: giftIds } } })) !== giftIds.length) {
    return "UNKNOWN_GIFT";
  }
  return null;
}

async function writeDefinition(tx: Prisma.TransactionClient, campaignId: string, draft: BenefitCampaignDraft) {
  await tx.benefitCampaignTarget.deleteMany({ where: { campaignId } });
  await tx.benefitCampaignTier.deleteMany({ where: { campaignId } });
  await tx.benefitCampaignGift.deleteMany({ where: { campaignId } });
  if (draft.targets.length > 0) {
    await tx.benefitCampaignTarget.createMany({
      data: draft.targets.map((target) =>
        "productId" in target
          ? { campaignId, productId: target.productId }
          : { campaignId, variantId: (target as { variantId: string }).variantId },
      ),
    });
  }
  await tx.benefitCampaignTier.createMany({
    data: draft.tiers.map((tier, position) => ({
      campaignId,
      position,
      thresholdQuantity: tier.thresholdQuantity,
      thresholdSubtotalVnd: tier.thresholdSubtotalVnd === null ? null : BigInt(tier.thresholdSubtotalVnd),
      percentageValue: tier.percentageValue,
    })),
  });
  if (draft.gifts.length > 0) {
    await tx.benefitCampaignGift.createMany({
      data: draft.gifts.map((gift, position) => ({
        campaignId,
        variantId: gift.variantId,
        position,
        quantity: gift.quantity,
      })),
    });
  }
}

export async function createBenefitCampaignDraft(
  prisma: Pick<PrismaClient, "$transaction">,
  input: BenefitCampaignDraft,
  createdByUserId: string | null,
): Promise<BenefitWriteResult> {
  const validated = validateBenefitCampaignDraft(input);
  if (!validated.ok) return { ok: false, reason: validated.reason };
  const { draft } = validated;

  return prisma.$transaction(async (tx): Promise<BenefitWriteResult> => {
    const bad = await checkReferences(tx, draft);
    if (bad) return { ok: false, reason: bad };
    const created = await tx.benefitCampaign.create({
      data: {
        kind: draft.kind,
        name: draft.name,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        createdByUserId,
      },
    });
    await writeDefinition(tx, created.id, draft);
    return { ok: true, id: created.id, version: created.version };
  });
}

/** Redefines a campaign that has never been enabled. A stale `expectedVersion` is refused. */
export async function replaceBenefitCampaignDraft(
  prisma: Pick<PrismaClient, "$transaction">,
  { id, expectedVersion, draft: input }: Readonly<{ id: string; expectedVersion: number; draft: BenefitCampaignDraft }>,
): Promise<BenefitWriteResult> {
  const validated = validateBenefitCampaignDraft(input);
  if (!validated.ok) return { ok: false, reason: validated.reason };
  const { draft } = validated;

  return prisma.$transaction(async (tx): Promise<BenefitWriteResult> => {
    const locked = await tx.$queryRaw<{ version: number; enabledAt: Date | null }[]>(Prisma.sql`
      SELECT "version", "enabledAt" FROM "BenefitCampaign" WHERE "id" = ${id} FOR UPDATE
    `);
    const current = locked[0];
    if (!current) return { ok: false, reason: "NOT_FOUND" };
    if (current.version !== expectedVersion) return { ok: false, reason: "STALE_VERSION" };
    if (current.enabledAt !== null) return { ok: false, reason: "ALREADY_STARTED" };

    const bad = await checkReferences(tx, draft);
    if (bad) return { ok: false, reason: bad };
    const updated = await tx.benefitCampaign.update({
      where: { id },
      data: {
        kind: draft.kind,
        name: draft.name,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        version: { increment: 1 },
      },
    });
    await writeDefinition(tx, id, draft);
    return { ok: true, id, version: updated.version };
  });
}

async function scopeOf(
  tx: Prisma.TransactionClient,
  targets: readonly { productId: string | null; variantId: string | null }[],
): Promise<ReadonlySet<string> | null> {
  if (targets.length === 0) return null;
  const products = new Set<string>();
  const variantIds: string[] = [];
  for (const target of targets) {
    if (target.productId) products.add(target.productId);
    if (target.variantId) variantIds.push(target.variantId);
  }
  if (variantIds.length > 0) {
    const variants = await tx.variantMirror.findMany({
      where: { id: { in: variantIds } },
      select: { productId: true },
    });
    for (const variant of variants) products.add(variant.productId);
  }
  return products;
}

/** Enables a draft if no accepted overlap rule forbids it. All checks and the write share one lock. */
export async function publishBenefitCampaign(
  prisma: Pick<PrismaClient, "$transaction">,
  { id, expectedVersion, now }: Readonly<{ id: string; expectedVersion: number; now: Date }>,
): Promise<BenefitWriteResult> {
  return prisma.$transaction(async (tx): Promise<BenefitWriteResult> => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${PUBLISH_LOCK_KEY}))`);

    const campaign = await tx.benefitCampaign.findUnique({
      where: { id },
      include: { targets: { select: { productId: true, variantId: true } }, tiers: { select: { id: true } } },
    });
    if (!campaign) return { ok: false, reason: "NOT_FOUND" };
    if (campaign.version !== expectedVersion) return { ok: false, reason: "STALE_VERSION" };
    if (campaign.isEnabled) return { ok: false, reason: "ALREADY_ENABLED" };
    if (campaign.endsAt !== null && campaign.endsAt.getTime() <= now.getTime()) {
      return { ok: false, reason: "WINDOW_ENDED" };
    }
    if (campaign.tiers.length === 0) return { ok: false, reason: "INVALID_TIERS" };

    const candidate: BenefitScopeFacts = {
      id: campaign.id,
      name: campaign.name,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      productIds: await scopeOf(tx, campaign.targets),
    };

    const stillRunning = { OR: [{ endsAt: null }, { endsAt: { gt: now } }] };
    const [otherBenefit, legacy] = await Promise.all([
      tx.benefitCampaign.findMany({
        where: { isEnabled: true, id: { not: id }, ...stillRunning },
        include: { targets: { select: { productId: true, variantId: true } } },
        take: 500,
      }),
      tx.promotionCampaign.findMany({
        where: { isEnabled: true, ...stillRunning },
        include: { targets: { select: { productId: true, variantId: true } } },
        take: 500,
      }),
    ]);
    const toFacts = async (
      rows: readonly { id: string; name: string; startsAt: Date | null; endsAt: Date | null; targets: { productId: string | null; variantId: string | null }[] }[],
    ): Promise<BenefitScopeFacts[]> =>
      Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          name: row.name,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          productIds: await scopeOf(tx, row.targets),
        })),
      );

    const conflicts = findBenefitPublishConflicts(candidate, await toFacts(otherBenefit), await toFacts(legacy));
    if (conflicts.length > 0) return { ok: false, reason: "CONFLICT", conflicts };

    const enabled = await tx.benefitCampaign.update({
      where: { id },
      data: { isEnabled: true, enabledAt: now, disabledAt: null, version: { increment: 1 } },
    });
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BenefitRevision" ("id", "revision", "updatedAt") VALUES ('current', 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO UPDATE SET "revision" = "BenefitRevision"."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
    `);
    return { ok: true, id, version: enabled.version };
  });
}

/** Disabling is always allowed. Nothing is deleted, and disabling a disabled campaign is a no-op. */
export async function disableBenefitCampaign(
  prisma: Pick<PrismaClient, "$transaction">,
  { id, now }: Readonly<{ id: string; now: Date }>,
): Promise<BenefitWriteResult> {
  return prisma.$transaction(async (tx): Promise<BenefitWriteResult> => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${PUBLISH_LOCK_KEY}))`);
    const campaign = await tx.benefitCampaign.findUnique({ where: { id }, select: { isEnabled: true, version: true } });
    if (!campaign) return { ok: false, reason: "NOT_FOUND" };
    if (!campaign.isEnabled) return { ok: true, id, version: campaign.version };

    const disabled = await tx.benefitCampaign.update({
      where: { id },
      data: { isEnabled: false, disabledAt: now, version: { increment: 1 } },
    });
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BenefitRevision" ("id", "revision", "updatedAt") VALUES ('current', 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO UPDATE SET "revision" = "BenefitRevision"."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
    `);
    return { ok: true, id, version: disabled.version };
  });
}

export async function readBenefitRevision(client: Pick<Prisma.TransactionClient, "benefitRevision">): Promise<bigint> {
  const row = await client.benefitRevision.findUnique({ where: { id: "current" }, select: { revision: true } });
  return row?.revision ?? BigInt(0);
}
