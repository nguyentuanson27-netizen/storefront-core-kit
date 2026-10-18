"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCurrentAdmin } from "@/auth/current-admin";
import { parseSizeGuideMediaInput } from "@/commerce/size-guide-media";
import {
  removeSizeGuideMedia,
  saveSizeGuideMedia,
} from "@/commerce/size-guide-media-repository";
import { prisma } from "@/db/prisma";
import { buildSizeGuideViewModel } from "@/routes/evergreen-model";

const BACK = "/admin/size-guide";

function knownGuideKeys(): string[] {
  return buildSizeGuideViewModel().charts.map((chart) => chart.id);
}

/**
 * Re-authorizes on the server and treats every field as untrusted: the image URL must pass the
 * reviewed-host trust rule and the guide key must be a configured chart, or nothing is stored. The
 * outcome is a redirect carrying only a typed reason from a closed set.
 */
export async function saveSizeGuideImage(formData: FormData): Promise<void> {
  const admin = await requireCurrentAdmin();
  const parsed = parseSizeGuideMediaInput(
    {
      guideKey: formData.get("guideKey"),
      imageUrl: formData.get("imageUrl"),
      altText: formData.get("altText"),
      width: formData.get("width"),
      height: formData.get("height"),
    },
    knownGuideKeys(),
  );
  if (!parsed.ok) redirect(`${BACK}?error=${parsed.reason}`);

  await saveSizeGuideMedia(prisma, parsed.media, admin.user.id);
  revalidatePath(BACK);
  revalidatePath("/size-guide");
  redirect(`${BACK}?saved=1`);
}

export async function removeSizeGuideImage(formData: FormData): Promise<void> {
  await requireCurrentAdmin();
  const guideKey = formData.get("guideKey");
  if (typeof guideKey !== "string" || !knownGuideKeys().includes(guideKey)) {
    redirect(`${BACK}?error=UNKNOWN_GUIDE`);
  }

  await removeSizeGuideMedia(prisma, guideKey);
  revalidatePath(BACK);
  revalidatePath("/size-guide");
  redirect(`${BACK}?saved=1`);
}
