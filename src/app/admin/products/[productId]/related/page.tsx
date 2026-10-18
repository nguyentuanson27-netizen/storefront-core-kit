import type { Metadata } from "next";
import Link from "next/link";

import { requireCurrentAdminPage } from "@/auth/current-admin";
import { notFound } from "next/navigation";

import { RELATED_OVERRIDE_MAX_ITEMS } from "@/commerce/related-product-override";
import { readRelatedOverrideIds } from "@/commerce/related-product-override-repository";
import {
  NEW_ARRIVALS_ADMIN_MESSAGES,
  readNewArrivalsAdminReason,
} from "@/commerce/new-arrivals-admin";
import {
  readNewArrivalsProductLabels,
  searchProductsForNewArrivals,
} from "@/commerce/new-arrivals-selection-repository";
import { AdminFormStatus } from "@/components/admin/admin-form-status";
import { prisma } from "@/db/prisma";

import { addRelatedOverrideProduct, saveRelatedOverrideOrder } from "./actions";

export const metadata: Metadata = {
  title: "Sản phẩm liên quan thủ công",
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

const inputClassName =
  "w-full border-b border-black/30 bg-transparent px-0 py-3 text-base outline-none transition-colors placeholder:text-black/35 focus-visible:border-black focus-visible:outline-2 focus-visible:outline-offset-4";
const buttonClassName =
  "border border-black px-5 py-3 text-xs font-semibold uppercase tracking-[0.13em] focus-visible:outline-2 focus-visible:outline-offset-4";

const MESSAGES = {
  ...NEW_ARRIVALS_ADMIN_MESSAGES,
  TOO_MANY: `Mỗi sản phẩm chỉ có tối đa ${RELATED_OVERRIDE_MAX_ITEMS} sản phẩm liên quan thủ công.`,
} as const;

export default async function AdminRelatedOverridePage({
  params: routeParams,
  searchParams,
}: Readonly<{ params: Promise<{ productId: string }>; searchParams: Promise<SearchParams> }>) {
  await requireCurrentAdminPage();
  const { productId: ownerId } = await routeParams;
  const params = await searchParams;
  const owner = await prisma.productMirror.findUnique({
    where: { id: ownerId },
    select: { id: true, name: true },
  });
  if (!owner) notFound();

  const relatedIds = await readRelatedOverrideIds(prisma, owner.id);
  const slots = relatedIds.map((productId, position) => ({ productId, position }));
  const labels = await readNewArrivalsProductLabels(
    prisma,
    slots.map(({ productId }) => productId),
  );
  const search = (queryValue(params.q) ?? "").slice(0, 80);
  const candidates = await searchProductsForNewArrivals(prisma, search);
  const selected = new Set([owner.id, ...slots.map(({ productId }) => productId)]);

  const error = queryValue(params.error);
  const status = error !== undefined ? "error" : queryValue(params.saved) === "1" ? "success" : null;
  const errorMessage = MESSAGES[readNewArrivalsAdminReason(error)];

  return (
    <div className="space-y-14">
      <header>
        <Link className="text-xs font-semibold uppercase tracking-[0.13em] underline underline-offset-4" href={`/admin/products/${owner.id}`}>
          ← Quay lại sản phẩm
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">Sản phẩm liên quan thủ công</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-black/65">
          Cho {owner.name}: tối đa {RELATED_OVERRIDE_MAX_ITEMS} sản phẩm bạn chọn tay, hiện có {slots.length}. Trang sản phẩm hiển thị tối đa 4 sản phẩm đang hiển thị trong danh sách này; nếu danh sách trống, trang dùng cách chọn theo collection như trước.
        </p>
      </header>

      <AdminFormStatus
        kind={status}
        successMessage="Đã lưu sản phẩm liên quan."
        errorMessage={errorMessage}
      />

      <section aria-labelledby="related-override-order-heading">
        <h2 id="related-override-order-heading" className="text-xl font-semibold">
          Thứ tự hiện tại
        </h2>
        {slots.length === 0 ? (
          <p className="mt-4 text-sm text-black/65">Chưa có sản phẩm nào trong danh sách.</p>
        ) : (
          <form action={saveRelatedOverrideOrder} className="mt-6">
            <input type="hidden" name="ownerProductId" value={owner.id} />
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                Sản phẩm liên quan theo thứ tự ưu tiên. Đổi số thứ tự hoặc đánh dấu để gỡ.
              </caption>
              <thead>
                <tr className="border-b border-black/20 text-xs uppercase tracking-[0.12em]">
                  <th className="py-3 pr-4 font-semibold" scope="col">Thứ tự</th>
                  <th className="py-3 pr-4 font-semibold" scope="col">Sản phẩm</th>
                  <th className="py-3 font-semibold" scope="col">Gỡ khỏi danh sách</th>
                </tr>
              </thead>
              <tbody>
                {slots.map(({ productId, position }) => {
                  const label = labels.get(productId);
                  const name = label?.name ?? "Sản phẩm không còn trong danh mục";
                  return (
                    <tr key={productId} className="border-b border-black/10">
                      <td className="py-3 pr-4">
                        <input type="hidden" name="productId" value={productId} />
                        <label>
                          <span className="sr-only">Thứ tự của {name}</span>
                          <input
                            className="w-20 border border-black/30 px-2 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                            defaultValue={position + 1}
                            inputMode="numeric"
                            max={RELATED_OVERRIDE_MAX_ITEMS}
                            min={1}
                            name="position"
                            type="number"
                          />
                        </label>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="font-semibold">{name}</span>
                        {label ? <span className="ml-2 text-black/55">{label.slug}</span> : null}
                      </td>
                      <td className="py-3">
                        <label className="flex items-center gap-2">
                          <input name="remove" type="checkbox" value={productId} />
                          <span>
                            Gỡ <span className="sr-only">{name}</span>
                          </span>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className={`${buttonClassName} mt-6`} type="submit">
              Lưu thứ tự
            </button>
          </form>
        )}
      </section>

      <section aria-labelledby="related-override-add-heading">
        <h2 id="related-override-add-heading" className="text-xl font-semibold">
          Thêm sản phẩm
        </h2>
        <form action={`/admin/products/${owner.id}/related`} className="mt-6 flex flex-col gap-4 md:flex-row md:items-end" method="get">
          <label className="block flex-1">
            <span className="text-xs font-semibold uppercase tracking-[0.13em]">Tìm theo tên hoặc slug</span>
            <input
              className={inputClassName}
              defaultValue={search}
              maxLength={80}
              minLength={2}
              name="q"
              type="search"
            />
          </label>
          <button className={buttonClassName} type="submit">
            Tìm
          </button>
        </form>

        {search.length >= 2 ? (
          candidates.length === 0 ? (
            <p className="mt-6 text-sm text-black/65" role="status">
              Không tìm thấy sản phẩm phù hợp.
            </p>
          ) : (
            <ul className="mt-6 divide-y divide-black/10">
              {candidates.map((candidate) => (
                <li key={candidate.id} className="flex items-center justify-between gap-4 py-3">
                  <span>
                    <span className="font-semibold">{candidate.name}</span>
                    <span className="ml-2 text-sm text-black/55">{candidate.slug}</span>
                  </span>
                  {selected.has(candidate.id) ? (
                    <span className="text-sm text-black/65">Đã có trong danh sách</span>
                  ) : (
                    <form action={addRelatedOverrideProduct}>
                      <input type="hidden" name="ownerProductId" value={owner.id} />
                      <input type="hidden" name="productId" value={candidate.id} />
                      <button className={buttonClassName} type="submit">
                        Thêm <span className="sr-only">{candidate.name}</span>
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}
