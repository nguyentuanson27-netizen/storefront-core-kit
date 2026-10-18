"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCurrentAdmin } from "@/auth/current-admin";
import type { BenefitCampaignDraft } from "@/commerce/benefit-campaign";
import { parseBenefitCampaignForm } from "@/commerce/benefit-campaign-form";
import {
  createBenefitCampaignDraft,
  disableBenefitCampaign,
  publishBenefitCampaign,
  type BenefitWriteResult,
} from "@/commerce/benefit-campaign-repository";
import { prisma } from "@/db/prisma";

/**
 * Re-authorize on the server, treat every field as untrusted, and report the outcome as a redirect that
 * carries only a typed reason. A publish refusal also carries the conflicting campaign's name so the
 * administrator knows what to move; the name is looked up from our own table, never from the request.
 */
async function finish(result: BenefitWriteResult): Promise<never> {
  if (!result.ok) {
    const conflict = result.conflicts?.[0];
    const suffix = conflict ? `&conflict=${encodeURIComponent(conflict.name.slice(0, 120))}` : "";
    redirect(`/admin/benefits?error=${result.reason}${suffix}`);
  }
  revalidatePath("/admin/benefits");
  redirect("/admin/benefits?saved=1");
}

const text = (value: FormDataEntryValue | null): string => (typeof value === "string" ? value : "");

export async function createBenefitCampaign(formData: FormData): Promise<void> {
  const admin = await requireCurrentAdmin();
  const parsed = parseBenefitCampaignForm({
    kind: formData.get("kind"),
    name: formData.get("name"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    thresholdKind: formData.get("thresholdKind"),
    productSlugs: formData.get("productSlugs"),
    tierThresholds: formData.getAll("tierThreshold"),
    tierPercents: formData.getAll("tierPercent"),
    giftRefs: formData.getAll("giftRef"),
    giftQuantities: formData.getAll("giftQuantity"),
  });
  if (!parsed.ok) redirect(`/admin/benefits?error=${parsed.reason}`);
  const { form } = parsed;

  const products = form.productSlugs.length
    ? await prisma.productMirror.findMany({ where: { slug: { in: [...form.productSlugs] } }, select: { id: true, slug: true } })
    : [];
  if (products.length !== form.productSlugs.length) redirect("/admin/benefits?error=UNKNOWN_TARGET");

  const refs = form.gifts.map((gift) => gift.ref);
  const variants = refs.length
    ? await prisma.variantMirror.findMany({
        where: { OR: [{ id: { in: refs } }, { pancakeVariationId: { in: refs } }] },
        select: { id: true, pancakeVariationId: true },
      })
    : [];
  const variantByRef = new Map<string, string>();
  for (const variant of variants) {
    variantByRef.set(variant.pancakeVariationId, variant.id);
    variantByRef.set(variant.id, variant.id);
  }
  const gifts = form.gifts.map((gift) => ({ variantId: variantByRef.get(gift.ref), quantity: gift.quantity }));
  if (gifts.some((gift) => gift.variantId === undefined)) redirect("/admin/benefits?error=UNKNOWN_GIFT");

  const draft: BenefitCampaignDraft = {
    kind: form.kind,
    name: form.name,
    startsAt: form.startsAt,
    endsAt: form.endsAt,
    targets: products.map((product) => ({ productId: product.id })),
    tiers: form.tiers,
    gifts: gifts.map((gift) => ({ variantId: gift.variantId!, quantity: gift.quantity })),
  };
  await finish(await createBenefitCampaignDraft(prisma, draft, admin.user.id));
}

export async function publishBenefit(formData: FormData): Promise<void> {
  await requireCurrentAdmin();
  const id = text(formData.get("id"));
  const version = Number(text(formData.get("version")));
  if (id === "" || id.length > 64 || !Number.isSafeInteger(version) || version < 1) {
    redirect("/admin/benefits?error=NOT_FOUND");
  }
  await finish(await publishBenefitCampaign(prisma, { id, expectedVersion: version, now: new Date() }));
}

export async function disableBenefit(formData: FormData): Promise<void> {
  await requireCurrentAdmin();
  const id = text(formData.get("id"));
  if (id === "" || id.length > 64) redirect("/admin/benefits?error=NOT_FOUND");
  await finish(await disableBenefitCampaign(prisma, { id, now: new Date() }));
}
