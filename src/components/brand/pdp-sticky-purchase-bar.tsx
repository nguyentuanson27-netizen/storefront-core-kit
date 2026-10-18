"use client";

import type { PurchaseCtaState, PurchaseOptionKey } from "@/components/headless/pdp-mobile-interaction-model";

/**
 * The brand's sticky mobile purchase bar. Markup and copy only.
 *
 * It decides nothing about money or purchasability: the price text is the panel's own
 * `priceDisplay`, the action is the panel's own `addToBag`, and what to say comes from
 * `PurchaseCtaState`. When a choice is still needed it moves the shopper to that choice in the real
 * panel rather than guessing one for them.
 *
 * The add outcome is read aloud by the panel's own live region, so the text shown here is
 * `aria-hidden`: it is feedback for a shopper who cannot see that panel, not a second announcement.
 */

/** The names the brand's `PurchasePanelView` gives each option's radio group. */
const OPTION_INPUT_NAME: Readonly<Record<PurchaseOptionKey, string>> = {
  kind: "storefront-kind",
  size: "storefront-size",
  color: "storefront-color",
};

const CHOOSE_LABEL: Readonly<Record<PurchaseOptionKey, string>> = {
  kind: "Chọn loại",
  size: "Chọn kích cỡ",
  color: "Chọn màu",
};

export function focusMissingOption(panel: HTMLElement | null, key: PurchaseOptionKey) {
  if (panel === null) return;
  const name = OPTION_INPUT_NAME[key];
  const target =
    panel.querySelector<HTMLInputElement>(`input[name="${name}"]:checked:not(:disabled)`)
    ?? panel.querySelector<HTMLInputElement>(`input[name="${name}"]:not(:disabled)`);
  if (target === null) {
    panel.scrollIntoView({ block: "center" });
    return;
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "center" });
}

export function PdpStickyPurchaseBar({
  cta,
  price,
  preorderLabel,
  message,
  onAdd,
  onChoose,
}: Readonly<{
  cta: PurchaseCtaState;
  price: Readonly<{ displayText: string; compareAtText: string | null }>;
  /** The panel's own preorder marker (`view.preorderMessage`), empty when the option is not a preorder. */
  preorderLabel: string;
  message: string;
  onAdd: () => void;
  onChoose: (key: PurchaseOptionKey) => void;
}>) {
  const firstMissing = cta.missing[0];
  const label =
    cta.kind === "pending"
      ? "Đang thêm…"
      : cta.kind === "choose"
        ? CHOOSE_LABEL[firstMissing ?? "size"]
        : cta.kind === "unavailable"
          ? cta.unavailableReason === "OUT_OF_STOCK"
            ? "Hết hàng"
            : "Chưa mua được"
          : "Thêm vào giỏ hàng";
  const disabled = cta.kind === "pending" || cta.kind === "unavailable";

  return (
    <section
      aria-label="Mua nhanh"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-black/20 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
      data-pdp-sticky-bar=""
    >
      <div className="flex items-center gap-4">
        <p className="min-w-0 flex-1 text-base font-medium tracking-[-0.02em]">
          {price.compareAtText ? (
            <>
              <span className="sr-only">Giá gốc </span>
              <span className="mr-2 text-sm font-normal text-black/60 line-through">{price.compareAtText}</span>
              <span className="sr-only">Giá khuyến mãi </span>
            </>
          ) : null}
          {price.displayText}
          {cta.kind === "preorder" && preorderLabel ? (
            <span data-preorder-marker="" className="mt-0.5 block text-xs font-semibold uppercase tracking-[0.12em]">
              {preorderLabel}
            </span>
          ) : null}
          {message ? (
            <span aria-hidden="true" className="mt-0.5 block truncate text-xs font-normal text-black/65">
              {message}
            </span>
          ) : null}
        </p>
        <button
          className="min-h-12 shrink-0 border border-black bg-black px-5 text-xs font-semibold uppercase tracking-[0.12em] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:border-black/20 disabled:bg-black/10 disabled:text-black/35"
          type="button"
          disabled={disabled}
          onClick={() => (cta.kind === "choose" ? onChoose(firstMissing ?? "size") : onAdd())}
        >
          {label}
        </button>
      </div>
    </section>
  );
}
