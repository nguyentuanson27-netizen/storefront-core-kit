import type { Metadata } from "next";

import { requireCurrentAdminPage } from "@/auth/current-admin";
import {
  NEW_ARRIVALS_ADMIN_MESSAGES,
  readNewArrivalsAdminReason,
} from "@/commerce/new-arrivals-admin";
import { NEW_ARRIVALS_MAX_ITEMS } from "@/commerce/new-arrivals-paging";
import {
  listNewArrivalsSelection,
  readNewArrivalsProductLabels,
  readNewArrivalsRevision,
  searchProductsForNewArrivals,
} from "@/commerce/new-arrivals-selection-repository";
import { AdminFormStatus } from "@/components/admin/admin-form-status";
import { prisma } from "@/db/prisma";

import { addNewArrivalsProduct, saveNewArrivalsOrder } from "./actions";

export const metadata: Metadata = {
  title: "Quản lý hàng mới",
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

const inputClassName =
  "w-full border-b border-black/30 bg-transparent px-0 py-3 text-base outline-none transition-colors placeholder:text-black/35 focus-visible:border-black focus-visible:outline-2 focus-visible:outline-offset-4";
const buttonClassName =
  "border border-black px-5 py-3 text-xs font-semibold uppercase tracking-[0.13em] focus-visible:outline-2 focus-visible:outline-offset-4";

export default async function AdminNewArrivalsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  await requireCurrentAdminPage();
  const params = await searchParams;

  const slots = await listNewArrivalsSelection(prisma);
  const revision = await readNewArrivalsRevision(prisma);
  const labels = await readNewArrivalsProductLabels(
    prisma,
    slots.map(({ productId }) => productId),
  );
  const search = (queryValue(params.q) ?? "").slice(0, 80);
  const candidates = await searchProductsForNewArrivals(prisma, search);
  const selected = new Set(slots.map(({ productId }) => productId));

  const error = queryValue(params.error);
  const status = error !== undefined ? "error" : queryValue(params.saved) === "1" ? "success" : null;
  const errorMessage = NEW_ARRIVALS_ADMIN_MESSAGES[readNewArrivalsAdminReason(error)];

  return (
    <div className="space-y-14">
      <header>
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">Hàng mới</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-black/65">
          Danh sách do bạn sắp xếp thủ công, tối đa {NEW_ARRIVALS_MAX_ITEMS} sản phẩm. Hiện có{" "}
          {slots.length}. Trang công khai chỉ dùng danh sách này khi tính năng được bật.
        </p>
      </header>

      <AdminFormStatus
        kind={status}
        successMessage="Đã lưu danh sách hàng mới."
        errorMessage={errorMessage}
      />

      <section aria-labelledby="new-arrivals-order-heading">
        <h2 id="new-arrivals-order-heading" className="text-xl font-semibold">
          Thứ tự hiện tại
        </h2>
        {slots.length === 0 ? (
          <p className="mt-4 text-sm text-black/65">Chưa có sản phẩm nào trong danh sách.</p>
        ) : (
          <form action={saveNewArrivalsOrder} className="mt-6">
            <input type="hidden" name="revision" value={revision.toString()} />
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                Sản phẩm hàng mới theo thứ tự hiển thị. Đổi số thứ tự hoặc đánh dấu để gỡ.
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
                            max={NEW_ARRIVALS_MAX_ITEMS}
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

      <section aria-labelledby="new-arrivals-add-heading">
        <h2 id="new-arrivals-add-heading" className="text-xl font-semibold">
          Thêm sản phẩm
        </h2>
        <form action="/admin/new-arrivals" className="mt-6 flex flex-col gap-4 md:flex-row md:items-end" method="get">
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
                    <form action={addNewArrivalsProduct}>
                      <input type="hidden" name="revision" value={revision.toString()} />
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
