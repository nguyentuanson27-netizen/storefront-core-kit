import type { Metadata } from "next";

import { requireCurrentAdminPage } from "@/auth/current-admin";
import {
  BENEFIT_MAX_GIFTS,
  BENEFIT_MAX_TIERS,
} from "@/commerce/benefit-campaign";
import { listBenefitCampaigns } from "@/commerce/benefit-campaign-repository";
import { AdminFormStatus } from "@/components/admin/admin-form-status";
import { prisma } from "@/db/prisma";

import { createBenefitCampaign, disableBenefit, publishBenefit } from "./actions";

export const metadata: Metadata = {
  title: "Quản lý ưu đãi theo giỏ hàng",
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

const inputClassName =
  "w-full border-b border-black/30 bg-transparent px-0 py-3 text-base outline-none transition-colors placeholder:text-black/35 focus-visible:border-black focus-visible:outline-2 focus-visible:outline-offset-4";
const buttonClassName =
  "border border-black px-5 py-3 text-xs font-semibold uppercase tracking-[0.13em] focus-visible:outline-2 focus-visible:outline-offset-4";
const labelClassName = "text-xs font-semibold uppercase tracking-[0.13em]";

const MESSAGES: Readonly<Record<string, string>> = {
  INVALID_KIND: "Loại ưu đãi không hợp lệ.",
  INVALID_NAME: "Tên ưu đãi phải có từ 1 đến 120 ký tự.",
  INVALID_DATE_TIME: "Thời gian không hợp lệ. Dùng giờ Việt Nam, ví dụ 2026-05-01T09:00.",
  INVALID_WINDOW: "Thời gian kết thúc phải sau thời gian bắt đầu.",
  INVALID_TARGETS: "Danh sách sản phẩm áp dụng không hợp lệ.",
  INVALID_TIERS: "Các mức ưu đãi phải là số nguyên dương, tăng dần, và mức giảm giá từ 1 đến 99%.",
  INVALID_GIFTS: "Quà tặng không hợp lệ: cần mã biến thể và số lượng từ 1 đến 5.",
  UNKNOWN_TARGET: "Có sản phẩm áp dụng không tồn tại trong danh mục.",
  UNKNOWN_GIFT: "Có quà tặng không tồn tại trong danh mục.",
  NOT_FOUND: "Không tìm thấy ưu đãi.",
  STALE_VERSION: "Ưu đãi đã được thay đổi ở nơi khác. Tải lại trang rồi thử lại.",
  ALREADY_STARTED: "Ưu đãi đã từng được bật nên không thể chỉnh sửa hoặc bật lại. Hãy tạo ưu đãi mới.",
  ALREADY_ENABLED: "Ưu đãi này đã được bật.",
  WINDOW_ENDED: "Thời gian của ưu đãi đã kết thúc.",
  CONFLICT_SCAN_LIMIT: "Không thể bật ưu đãi vì có hơn 500 chiến dịch có thể trùng phạm vi và thời gian. Hãy thu hẹp phạm vi hoặc thời gian áp dụng.",
  CONFLICT: "Ưu đãi trùng phạm vi và thời gian với một ưu đãi đang bật.",
};

const KIND_LABEL: Readonly<Record<string, string>> = {
  QUANTITY_TIER: "Giảm theo số lượng",
  GIFT_ITEM: "Tặng quà",
};

const formatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});
const when = (value: Date | null, fallback: string): string => (value ? formatter.format(value) : fallback);

export default async function AdminBenefitsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  await requireCurrentAdminPage();
  const params = await searchParams;
  const campaigns = await listBenefitCampaigns(prisma);

  const error = queryValue(params.error);
  const status = error !== undefined ? "error" : queryValue(params.saved) === "1" ? "success" : null;
  const conflict = (queryValue(params.conflict) ?? "").slice(0, 120);
  const baseMessage = (error !== undefined ? MESSAGES[error] : undefined) ?? "Không thể lưu. Kiểm tra các trường rồi thử lại.";
  const errorMessage = error === "CONFLICT" && conflict ? `${baseMessage} Ưu đãi trùng: ${conflict}.` : baseMessage;

  const tierRows = Array.from({ length: BENEFIT_MAX_TIERS }, (_, index) => index);
  const giftRows = Array.from({ length: BENEFIT_MAX_GIFTS }, (_, index) => index);

  return (
    <div className="space-y-14">
      <header>
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">Ưu đãi theo giỏ hàng</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-black/65">
          Giảm giá theo số lượng hoặc tặng quà theo giá trị giỏ hàng. Ưu đãi mới luôn ở trạng thái nháp; chỉ khi bạn bật thì mới
          được lưu là đang bật. Cửa hàng chưa đọc các ưu đãi này khi thanh toán, nên việc bật ở đây chưa ảnh hưởng đến giá khách thấy.
        </p>
      </header>

      <AdminFormStatus kind={status} successMessage="Đã lưu ưu đãi." errorMessage={errorMessage} />

      <section aria-labelledby="benefit-list-heading">
        <h2 id="benefit-list-heading" className="text-xl font-semibold">
          Danh sách ưu đãi
        </h2>
        {campaigns.length === 0 ? (
          <p className="mt-4 text-sm text-black/65">Chưa có ưu đãi nào.</p>
        ) : (
          <table className="mt-6 w-full border-collapse text-left text-sm">
            <caption className="sr-only">Các ưu đãi theo giỏ hàng, mới thay đổi nhất ở trên.</caption>
            <thead>
              <tr className="border-b border-black/20 text-xs uppercase tracking-[0.12em]">
                <th className="py-3 pr-4 font-semibold" scope="col">Tên</th>
                <th className="py-3 pr-4 font-semibold" scope="col">Loại</th>
                <th className="py-3 pr-4 font-semibold" scope="col">Thời gian</th>
                <th className="py-3 pr-4 font-semibold" scope="col">Trạng thái</th>
                <th className="py-3 font-semibold" scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="border-b border-black/10 align-top">
                  <th className="py-3 pr-4 font-semibold" scope="row">
                    {campaign.name}
                    <span className="mt-1 block text-xs font-normal text-black/55">
                      {campaign.targetCount === 0 ? "Toàn cửa hàng" : `${campaign.targetCount} sản phẩm/biến thể`}
                      {" · "}
                      {campaign.tierCount} mức
                      {campaign.giftCount > 0 ? ` · ${campaign.giftCount} quà` : ""}
                    </span>
                  </th>
                  <td className="py-3 pr-4">{KIND_LABEL[campaign.kind] ?? campaign.kind}</td>
                  <td className="py-3 pr-4">
                    {when(campaign.startsAt, "Ngay")} – {when(campaign.endsAt, "Không giới hạn")}
                  </td>
                  <td className="py-3 pr-4">
                    {campaign.isEnabled ? "Đang bật" : campaign.enabledAt ? "Đã tắt" : "Nháp"}
                  </td>
                  <td className="py-3">
                    {campaign.isEnabled ? (
                      <form action={disableBenefit}>
                        <input type="hidden" name="id" value={campaign.id} />
                        <button className={buttonClassName} type="submit">
                          Tắt <span className="sr-only">{campaign.name}</span>
                        </button>
                      </form>
                    ) : campaign.enabledAt ? (
                      <span className="text-black/55">Tạo bản mới để bật lại</span>
                    ) : (
                      <form action={publishBenefit}>
                        <input type="hidden" name="id" value={campaign.id} />
                        <input type="hidden" name="version" value={campaign.version} />
                        <button className={buttonClassName} type="submit">
                          Bật <span className="sr-only">{campaign.name}</span>
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="benefit-create-heading">
        <h2 id="benefit-create-heading" className="text-xl font-semibold">
          Tạo ưu đãi nháp
        </h2>
        <form action={createBenefitCampaign} className="mt-6 space-y-8">
          <label className="block">
            <span className={labelClassName}>Tên ưu đãi</span>
            <input className={inputClassName} maxLength={120} name="name" required type="text" />
          </label>

          <div className="grid gap-6 md:grid-cols-2">
            <label className="block">
              <span className={labelClassName}>Loại ưu đãi</span>
              <select className={inputClassName} defaultValue="QUANTITY_TIER" name="kind">
                <option value="QUANTITY_TIER">Giảm theo số lượng</option>
                <option value="GIFT_ITEM">Tặng quà</option>
              </select>
            </label>
            <label className="block">
              <span className={labelClassName}>Ngưỡng tính theo</span>
              <select className={inputClassName} defaultValue="QUANTITY" name="thresholdKind">
                <option value="QUANTITY">Số lượng sản phẩm</option>
                <option value="SUBTOTAL">Giá trị giỏ hàng (VND)</option>
              </select>
            </label>
            <label className="block">
              <span className={labelClassName}>Bắt đầu (giờ Việt Nam, để trống = ngay)</span>
              <input className={inputClassName} name="startsAt" type="datetime-local" />
            </label>
            <label className="block">
              <span className={labelClassName}>Kết thúc (để trống = không giới hạn)</span>
              <input className={inputClassName} name="endsAt" type="datetime-local" />
            </label>
          </div>

          <label className="block">
            <span className={labelClassName}>Slug sản phẩm áp dụng (cách nhau bằng dấu phẩy; để trống = toàn cửa hàng)</span>
            <textarea className={inputClassName} name="productSlugs" rows={2} />
          </label>

          <fieldset>
            <legend className={labelClassName}>Các mức ưu đãi</legend>
            <p className="mt-2 text-sm text-black/65">
              Bỏ trống các dòng không dùng. Tặng quà chỉ dùng một mức. Giảm giá nhập phần trăm từ 1 đến 99.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {tierRows.map((index) => (
                <div key={index} className="contents">
                  <label className="block">
                    <span className="text-sm">Ngưỡng của mức {index + 1}</span>
                    <input className={inputClassName} inputMode="numeric" name="tierThreshold" type="text" />
                  </label>
                  <label className="block">
                    <span className="text-sm">Giảm % của mức {index + 1}</span>
                    <input className={inputClassName} inputMode="numeric" name="tierPercent" type="text" />
                  </label>
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={labelClassName}>Quà tặng (chỉ cho loại Tặng quà)</legend>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {giftRows.map((index) => (
                <div key={index} className="contents">
                  <label className="block">
                    <span className="text-sm">Mã biến thể quà {index + 1}</span>
                    <input className={inputClassName} maxLength={64} name="giftRef" type="text" />
                  </label>
                  <label className="block">
                    <span className="text-sm">Số lượng quà {index + 1}</span>
                    <input className={inputClassName} inputMode="numeric" name="giftQuantity" type="text" />
                  </label>
                </div>
              ))}
            </div>
          </fieldset>

          <button className={buttonClassName} type="submit">
            Lưu nháp
          </button>
        </form>
      </section>
    </div>
  );
}
