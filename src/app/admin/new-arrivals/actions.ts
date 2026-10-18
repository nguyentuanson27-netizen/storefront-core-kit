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
  listNewArrivalsSelection,
  replaceNewArrivalsSelection,
} from "@/commerce/new-arrivals-selection-repository";
import { prisma } from "@/db/prisma";

/**
 * Both actions re-authorize on the server and treat every field as untrusted: the browser's view of
 * who may edit, how long the list is or which revision is current is never an input. The outcome
 * travels back as a redirect carrying only a typed reason; the sentence shown is looked up on the
 * server when the page re-renders.
 */
async function applyPlan(plan: NewArrivalsEditPlan, userId: string): Promise<never> {
  if (!plan.ok) redirect(`/admin/new-arrivals?error=${plan.reason}`);

  const result = await replaceNewArrivalsSelection(prisma, {
    productIds: plan.productIds,
    expectedRevision: plan.revision,
    updatedByUserId: userId,
  });
  if (!result.ok) redirect(`/admin/new-arrivals?error=${result.reason}`);

  revalidatePath("/admin/new-arrivals");
  revalidatePath("/new-arrivals");
  redirect("/admin/new-arrivals?saved=1");
}

export async function saveNewArrivalsOrder(formData: FormData): Promise<void> {
  const admin = await requireCurrentAdmin();
  const plan = planNewArrivalsOrder({
    revision: formData.get("revision"),
    productIds: formData.getAll("productId"),
    positions: formData.getAll("position"),
    removals: formData.getAll("remove"),
  });
  await applyPlan(plan, admin.user.id);
}

export async function addNewArrivalsProduct(formData: FormData): Promise<void> {
  const admin = await requireCurrentAdmin();
  const current = (await listNewArrivalsSelection(prisma)).map(({ productId }) => productId);
  const plan = planNewArrivalsAppend({
    revision: formData.get("revision"),
    productIds: current,
    productId: formData.get("productId"),
  });
  await applyPlan(plan, admin.user.id);
}
