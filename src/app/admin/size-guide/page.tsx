import type { Metadata } from "next";

import { requireCurrentAdminPage } from "@/auth/current-admin";
import {
  SIZE_GUIDE_MEDIA_MAX_ALT_LENGTH,
  SIZE_GUIDE_MEDIA_MAX_DIMENSION,
  SIZE_GUIDE_MEDIA_MESSAGES,
  readSizeGuideMediaReason,
} from "@/commerce/size-guide-media";
import { listSizeGuideMedia } from "@/commerce/size-guide-media-repository";
import { AdminFormStatus } from "@/components/admin/admin-form-status";
import { prisma } from "@/db/prisma";
import { buildSizeGuideViewModel } from "@/routes/evergreen-model";

import { removeSizeGuideImage, saveSizeGuideImage } from "./actions";

export const metadata: Metadata = {
  title: "Ảnh bảng size",
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

const inputClassName =
  "w-full border-b border-black/30 bg-transparent px-0 py-3 text-base outline-none transition-colors placeholder:text-black/35 focus-visible:border-black focus-visible:outline-2 focus-visible:outline-offset-4";
const buttonClassName =
  "border border-black px-5 py-3 text-xs font-semibold uppercase tracking-[0.13em] focus-visible:outline-2 focus-visible:outline-offset-4";

export default async function AdminSizeGuidePage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  await requireCurrentAdminPage();
  const params = await searchParams;
  const charts = buildSizeGuideViewModel().charts;
  const stored = new Map((await listSizeGuideMedia(prisma)).map((row) => [row.guideKey, row]));

  const error = queryValue(params.error);
  const status = error !== undefined ? "error" : queryValue(params.saved) === "1" ? "success" : null;

  return (
    <div className="space-y-14">
      <header>
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">Ảnh bảng size</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-black/65">
          Mỗi bảng size có thể có một ảnh minh họa đặt cạnh bảng số đo đã duyệt; ảnh không thay thế hay thay đổi số đo.
          Ảnh phải là liên kết HTTPS từ nguồn ảnh đã được duyệt (Pancake CDN). Ảnh chỉ hiển thị khi tính năng được bật.
        </p>
      </header>

      <AdminFormStatus
        kind={status}
        successMessage="Đã lưu ảnh bảng size."
        errorMessage={SIZE_GUIDE_MEDIA_MESSAGES[readSizeGuideMediaReason(error)]}
      />

      {charts.map((chart) => {
        const current = stored.get(chart.id);
        return (
          <section key={chart.id} aria-labelledby={`size-guide-${chart.id}-heading`}>
            <h2 id={`size-guide-${chart.id}-heading`} className="text-xl font-semibold">
              {chart.title}
            </h2>
            <form action={saveSizeGuideImage} className="mt-6 grid gap-6 md:grid-cols-2">
              <input type="hidden" name="guideKey" value={chart.id} />
              <label className="block md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.13em]">Liên kết ảnh</span>
                <input
                  className={inputClassName}
                  defaultValue={current?.imageUrl ?? ""}
                  maxLength={2048}
                  name="imageUrl"
                  required
                  type="url"
                />
              </label>
              <label className="block md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.13em]">Mô tả ảnh (alt)</span>
                <input
                  className={inputClassName}
                  defaultValue={current?.altText ?? ""}
                  maxLength={SIZE_GUIDE_MEDIA_MAX_ALT_LENGTH}
                  name="altText"
                  required
                  type="text"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.13em]">Chiều rộng (px)</span>
                <input
                  className={inputClassName}
                  defaultValue={current?.width ?? ""}
                  inputMode="numeric"
                  max={SIZE_GUIDE_MEDIA_MAX_DIMENSION}
                  min={1}
                  name="width"
                  required
                  type="number"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.13em]">Chiều cao (px)</span>
                <input
                  className={inputClassName}
                  defaultValue={current?.height ?? ""}
                  inputMode="numeric"
                  max={SIZE_GUIDE_MEDIA_MAX_DIMENSION}
                  min={1}
                  name="height"
                  required
                  type="number"
                />
              </label>
              <div>
                <button className={buttonClassName} type="submit">
                  Lưu ảnh <span className="sr-only">cho {chart.title}</span>
                </button>
              </div>
            </form>
            {current ? (
              <form action={removeSizeGuideImage} className="mt-4">
                <input type="hidden" name="guideKey" value={chart.id} />
                <button className={buttonClassName} type="submit">
                  Gỡ ảnh <span className="sr-only">của {chart.title}</span>
                </button>
              </form>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
