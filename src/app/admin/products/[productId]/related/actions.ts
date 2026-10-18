"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCurrentAdmin } from "@/auth/current-admin";
import {
  planNewArrivalsAppend,
  planNewArrivalsOrder,
  type NewArrivalsEditPlan,
} from "@/commerce/new-arrivals-admin";
import {
  RELATED_OVERRIDE_MAX_ITEMS,
} from "@/commerce/related-product-override";
import {
  readRelatedOverrideIds,
  replaceRelatedOverrides,
} from "@/commerce/related-product-override-repository";
import { prisma } from "@/db/prisma";

const LIMITS = { maxItems: RELATED_OVERRIDE_MAX_ITEMS } as const;

function readOwnerId(formData: FormData): string {
  const value = formData.get("ownerProductId");
  if (typeof value !== "string" || value.length === 0 || value.length > 64) redirect("/admin");
  return value;
}

/**
 * Re-authorizes on the server and treats every field as untrusted. The planner's revision token is
 * unused here (the override list has no revision; the repository row-locks the product instead), so
 * a constant satisfies its shape.
 */
async function applyPlan(ownerId: string, plan: NewArrivalsEditPlan, userId: string): Promise<never> {
  const back = `/admin/products/${encodeURIComponent(ownerId)}/related`;
  if (!plan.ok) redirect(`${back}?error=${plan.reason}`);

  const result = await replaceRelatedOverrides(prisma, {
    productId: ownerId,
    relatedProductIds: plan.productIds,
    updatedByUserId: userId,
  });
  if (!result.ok) {
    const reason = result.reason === "SELF_REFERENCE" ? "INVALID" : result.reason;
    redirect(`${back}?error=${reason}`);
  }

  revalidatePath(back);
  redirect(`${back}?saved=1`);
}

export async function saveRelatedOverrideOrder(formData: FormData): Promise<void> {
  const admin = await requireCurrentAdmin();
  const ownerId = readOwnerId(formData);
  const plan = planNewArrivalsOrder(
    {
      revision: "0",
      productIds: formData.getAll("productId"),
      positions: formData.getAll("position"),
      removals: formData.getAll("remove"),
    },
    LIMITS,
  );
  await applyPlan(ownerId, plan, admin.user.id);
}

export async function addRelatedOverrideProduct(formData: FormData): Promise<void> {
  const admin = await requireCurrentAdmin();
  const ownerId = readOwnerId(formData);
  const current = await readRelatedOverrideIds(prisma, ownerId);
  const plan = planNewArrivalsAppend(
    { revision: "0", productIds: current, productId: formData.get("productId") },
    LIMITS,
  );
  await applyPlan(ownerId, plan, admin.user.id);
}
