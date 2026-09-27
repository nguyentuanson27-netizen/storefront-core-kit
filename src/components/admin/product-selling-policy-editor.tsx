import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCurrentAdmin } from "@/auth/current-admin";
import {
  DEFAULT_NEGATIVE_STOCK_LIMIT,
  SELLING_POLICY_RESET,
  effectivePolicy,
  readSellingModeFlags,
  resolveSellingPolicy,
  type SellingMode,
} from "@/commerce/selling-policy";
import { createSellingPolicyAdminService, type SellingPolicyUpdateRefusal } from "@/commerce/selling-policy-admin";
import { createSellingPolicyRepository } from "@/commerce/selling-policy-repository";
import { prisma } from "@/db/prisma";

const repository = createSellingPolicyRepository(prisma);
const adminService = createSellingPolicyAdminService({
  readFlags: () => readSellingModeFlags(),
  productExists: repository.productExists,
  productHasCompositeParent: repository.productHasCompositeParent,
  saveSellingPolicy: repository.saveSellingPolicy,
});

const MODE_LABELS: Readonly<Record<SellingMode, string>> = {
  STANDARD: "Tiêu chuẩn — bán tới khi hết hàng (0)",
  OVERSELL: "Bán vượt — bán xuống tới giới hạn âm, không hiện nhãn",
  PREORDER: "Đặt trước — bán xuống tới giới hạn âm, hết hàng sẵn thì hiện nhãn đặt trước",
};

const ERROR_MESSAGES: Readonly<Record<SellingPolicyUpdateRefusal, string>> = {
  INVALID_INPUT: "Giá trị không hợp lệ. Giới hạn phải là số nguyên từ -100000 đến 0.",
  PRODUCT_NOT_FOUND: "Không tìm thấy sản phẩm.",
  SELLING_MODES_DISABLED: "Chế độ bán chưa được bật cho website này (SELLING_MODES_ENABLED).",
  PREORDER_DISABLED: "Đặt trước chưa được bật cho website này (SELLING_MODE_PREORDER_ENABLED).",
  COMPOSITE_MODE_UNSUPPORTED: "Sản phẩm có biến thể dạng set: chỉ được bán theo chế độ Tiêu chuẩn.",
};

const DOWNGRADE_MESSAGES = {
  SELLING_MODES_DISABLED: "Chế độ bán đang tắt trên website này, nên sản phẩm đang được bán như Tiêu chuẩn.",
  PREORDER_DISABLED: "Đặt trước đang tắt trên website này, nên sản phẩm đang được bán như Tiêu chuẩn.",
} as const;

const inputClassName =
  "w-full border-b border-black/30 bg-transparent px-0 py-3 text-base outline-none transition-colors focus-visible:border-black focus-visible:outline-2 focus-visible:outline-offset-4";

function isRefusal(value: string | undefined): value is SellingPolicyUpdateRefusal {
  return value !== undefined && Object.hasOwn(ERROR_MESSAGES, value);
}

type ProductSellingPolicyEditorProps = {
  productId: string;
  editorPath: string;
  saved: boolean;
  error: string | undefined;
};

/**
 * One fieldset in the existing product editor (spec §10.1). Presentation only: every rule lives in
 * `createSellingPolicyAdminService` and `effectivePolicy`, and the actor comes from the session.
 */
export async function ProductSellingPolicyEditor({
  productId,
  editorPath,
  saved,
  error,
}: ProductSellingPolicyEditorProps) {
  const flags = readSellingModeFlags();
  const stored = await repository.readStoredPolicy(productId);
  const resolved = resolveSellingPolicy(stored);
  const effective = effectivePolicy(stored, flags);

  async function saveSellingPolicy(formData: FormData) {
    "use server";

    const adminSession = await requireCurrentAdmin();
    const result = await adminService.update(adminSession, {
      productId,
      sellingMode: formData.get("sellingMode"),
      negativeStockLimit: formData.get("negativeStockLimit"),
    });

    if (!result.ok) {
      if (result.reason === "PRODUCT_NOT_FOUND") redirect("/admin");
      redirect(`${editorPath}?sellingPolicyError=${result.reason}`);
    }

    revalidatePath(editorPath);
    redirect(`${editorPath}?sellingPolicySaved=1`);
  }

  const modeChoices: readonly Readonly<{ value: string; label: string; disabled: boolean }>[] = [
    { value: SELLING_POLICY_RESET, label: "Mặc định (không cấu hình — Tiêu chuẩn)", disabled: false },
    { value: "STANDARD", label: MODE_LABELS.STANDARD, disabled: false },
    { value: "OVERSELL", label: MODE_LABELS.OVERSELL, disabled: !flags.sellingModesEnabled },
    {
      value: "PREORDER",
      label: MODE_LABELS.PREORDER,
      disabled: !flags.sellingModesEnabled || !flags.preorderEnabled,
    },
  ];
  const checkedValue = resolved.isDefault ? SELLING_POLICY_RESET : resolved.sellingMode;

  return (
    <section aria-labelledby="product-selling-policy-heading" className="mt-8 border border-black/20 p-6 md:p-8">
      <p className="eyebrow">Tồn kho · sở hữu bởi website</p>
      <h2 id="product-selling-policy-heading" className="mt-2 font-serif text-3xl tracking-[-0.03em]">
        Chính sách bán
      </h2>
      <p className="mt-4 max-w-3xl text-xs leading-5 text-black/55">
        Giới hạn âm đặt cho cả sản phẩm và áp riêng cho từng biến thể. Đồng bộ Pancake không ghi đè chính sách
        này. Sản phẩm chưa cấu hình được bán như Tiêu chuẩn.
      </p>

      {saved ? (
        <p className="mt-5 border-l-2 border-black pl-4 text-sm font-semibold" role="status">
          Đã lưu chính sách bán.
        </p>
      ) : null}
      {isRefusal(error) ? (
        <p className="mt-5 border-l-2 border-black pl-4 text-sm font-semibold" role="alert">
          {ERROR_MESSAGES[error]} Không có thay đổi nào được lưu.
        </p>
      ) : null}
      {effective.kind === "REFUSE" ? (
        <p className="mt-5 border-l-2 border-black pl-4 text-sm font-semibold" role="alert">
          Chính sách đang lưu không hợp lệ nên sản phẩm này đang ngừng bán (INVALID_POLICY). Hãy lưu lại giá trị
          hợp lệ.
        </p>
      ) : effective.downgrade !== null ? (
        <p className="mt-5 border-l-2 border-black pl-4 text-sm" role="status">
          {DOWNGRADE_MESSAGES[effective.downgrade]}
        </p>
      ) : null}

      <form action={saveSellingPolicy} className="mt-6 grid gap-6 md:grid-cols-[2fr_1fr]">
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-[0.13em]">Chế độ bán</legend>
          <div className="mt-3 grid gap-2">
            {modeChoices.map((choice) => (
              <label className="flex min-h-11 items-center gap-3 text-sm" key={choice.value}>
                <input
                  defaultChecked={checkedValue === choice.value}
                  disabled={choice.disabled && checkedValue !== choice.value}
                  name="sellingMode"
                  type="radio"
                  value={choice.value}
                />
                <span>{choice.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.13em]">Giới hạn âm</span>
          <input
            className={inputClassName}
            defaultValue={String(resolved.isDefault ? DEFAULT_NEGATIVE_STOCK_LIMIT : resolved.negativeStockLimit)}
            inputMode="numeric"
            max={0}
            min={-100000}
            name="negativeStockLimit"
            step={1}
            type="number"
          />
          <span className="mt-3 block text-xs leading-5 text-black/55">
            Ví dụ với -20: tồn -19 vẫn nhận thêm 1, tồn -20 thì dừng. Tiêu chuẩn luôn dừng ở 0.
          </span>
        </label>

        <div className="md:col-span-2">
          <button
            className="inline-flex min-h-11 items-center justify-center border border-black px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4"
            type="submit"
          >
            Lưu chính sách bán
          </button>
        </div>
      </form>
    </section>
  );
}
