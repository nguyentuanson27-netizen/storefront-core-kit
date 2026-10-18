"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useCartDrawer } from "@/components/headless/use-cart-drawer";

/**
 * The brand's cart drawer: the header's cart link, plus a dialog that summarises the cart.
 *
 * Markup and copy only. It renders the server's `CartDrawerView` as given -- prices, availability
 * words, subtotal and whether checkout is offered are all decided on the server -- and edits
 * nothing: changing a quantity stays on `/cart`. Without JavaScript, or with a modified click, the
 * link is simply the link to `/cart` it always was.
 */

const closeButtonClassName =
  "inline-flex min-h-11 min-w-11 items-center justify-center border border-black/30 px-3 text-xs font-semibold uppercase tracking-[0.12em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

const actionClassName =
  "inline-flex min-h-12 w-full items-center justify-center border border-black px-5 text-xs font-semibold uppercase tracking-[0.12em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

export function CartDrawerTrigger({ href, label }: Readonly<{ href: string; label: string }>) {
  const triggerRef = useRef<HTMLAnchorElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const drawer = useCartDrawer({ triggerRef, dialogRef });

  return (
    <>
      <Link ref={triggerRef} href={href} onClick={drawer.onTriggerClick}>
        {label}
      </Link>

      {drawer.open ? (
        <BodyPortal>
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={drawer.close} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawer.titleId}
            tabIndex={-1}
            onKeyDown={drawer.onDialogKeyDown}
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-xl outline-none"
          >
            <div className="flex items-center justify-between gap-4 border-b border-black/20 px-5 py-4">
              <h2 id={drawer.titleId} className="font-serif text-2xl tracking-[-0.03em]">
                Giỏ hàng
              </h2>
              <button type="button" className={closeButtonClassName} onClick={drawer.close}>
                Đóng<span className="sr-only"> giỏ hàng</span>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {drawer.status === "loading" ? (
                <p role="status" className="text-sm text-black/65">
                  Đang tải giỏ hàng…
                </p>
              ) : null}

              {drawer.status === "error" ? (
                <div role="alert" className="grid gap-4 text-sm">
                  <p>Không thể tải giỏ hàng lúc này.</p>
                  <button type="button" className={closeButtonClassName} onClick={drawer.retry}>
                    Thử lại
                  </button>
                </div>
              ) : null}

              {drawer.view?.isEmpty ? (
                <div className="grid gap-4 text-sm">
                  <p>Giỏ hàng của bạn đang trống.</p>
                  <Link href="/shop" className={closeButtonClassName} onClick={drawer.close}>
                    Tiếp tục mua sắm
                  </Link>
                </div>
              ) : null}

              {drawer.view && !drawer.view.isEmpty ? (
                <ul aria-label="Sản phẩm trong giỏ hàng" className="grid gap-5">
                  {drawer.view.lines.map((line) => (
                    <li key={line.key} className="flex gap-4">
                      <div className="relative h-24 w-20 shrink-0 overflow-hidden bg-black/5">
                        {line.image ? (
                          <Image src={line.image.url} alt={line.image.alt} fill sizes="80px" className="object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1 text-sm">
                        {line.href ? (
                          <Link href={line.href} className="font-medium hover:underline" onClick={drawer.close}>
                            {line.productName}
                          </Link>
                        ) : (
                          <p className="font-medium">{line.productName}</p>
                        )}
                        <p className="mt-1 text-black/65">{line.optionLabel}</p>
                        <p className="mt-1 text-black/65">Số lượng: {line.quantity}</p>
                        <p className="mt-1">{line.priceText}</p>
                        {line.preorderMarker ? <p className="mt-1 text-black/65">{line.preorderMarker}</p> : null}
                        {line.available ? null : <p className="mt-1 font-medium">{line.availabilityLabel}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {drawer.view && !drawer.view.isEmpty ? (
              <div className="grid gap-3 border-t border-black/20 px-5 py-4">
                <p className="flex items-baseline justify-between text-sm">
                  <span>Tạm tính</span>
                  <span className="text-base font-medium">{drawer.view.subtotalText}</span>
                </p>
                <Link href="/cart" className={actionClassName} onClick={drawer.close}>
                  Xem giỏ hàng
                </Link>
                {drawer.view.canCheckout ? (
                  <Link
                    href="/checkout"
                    className={`${actionClassName} bg-black text-white!`}
                    onClick={drawer.close}
                  >
                    Thanh toán
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        </BodyPortal>
      ) : null}
    </>
  );
}

/**
 * The dialog is placed under `document.body`, not where the link is. The link lives inside the
 * header's utility `<nav>`, whose descendant-link rules (including hiding some links on narrow
 * viewports) would otherwise reach the dialog's own links. It only renders once opened, which is
 * a client event, so `document` always exists.
 */
function BodyPortal({ children }: Readonly<{ children: ReactNode }>) {
  return createPortal(children, document.body);
}
