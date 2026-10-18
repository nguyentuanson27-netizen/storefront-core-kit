"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCurrentAdmin } from "@/auth/current-admin";
import {
  HOMEPAGE_FEATURED_MAX_ITEMS,
  listHomepageFeatured,
  replaceHomepageFeatured,
} from "@/commerce/homepage-featured-repository";
import {
  planNewArrivalsAppend,
  planNewArrivalsOrder,
  type NewArrivalsEditPlan,
} from "@/commerce/new-arrivals-admin";
import { prisma } from "@/db/prisma";

const LIMITS = { maxItems: HOMEPAGE_FEATURED_MAX_ITEMS } as const;

/**
 * Same contract as the new-arrivals curator: re-authorize on the server, treat every field as
 * untrusted, and report the outcome as a redirect carrying only a typed reason.
 */
async function applyPlan(plan: NewArrivalsEditPlan, userId: string): Promise<never> {
  if (!plan.ok) redirect(`/admin/homepage-featured?error=${plan.reason}`);

  const result = await replaceHomepageFeatured(prisma, {
    productIds: plan.productIds,
    expectedRevision: plan.revision,
    updatedByUserId: userId,
  });
  if (!result.ok) redirect(`/admin/homepage-featured?error=${result.reason}`);

  revalidatePath("/admin/homepage-featured");
  revalidatePath("/");
  redirect("/admin/homepage-featured?saved=1");
}

export async function saveHomepageFeaturedOrder(formData: FormData): Promise<void> {
  const admin = await requireCurrentAdmin();
  const plan = planNewArrivalsOrder(
    {
      revision: formData.get("revision"),
      productIds: formData.getAll("productId"),
      positions: formData.getAll("position"),
      removals: formData.getAll("remove"),
    },
    LIMITS,
  );
  await applyPlan(plan, admin.user.id);
}

export async function addHomepageFeaturedProduct(formData: FormData): Promise<void> {
  const admin = await requireCurrentAdmin();
  const current = (await listHomepageFeatured(prisma)).map(({ productId }) => productId);
  const plan = planNewArrivalsAppend(
    {
      revision: formData.get("revision"),
      productIds: current,
      productId: formData.get("productId"),
    },
    LIMITS,
  );
  await applyPlan(plan, admin.user.id);
}
