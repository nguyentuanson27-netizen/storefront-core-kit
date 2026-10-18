"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useSearchOverlay } from "@/components/headless/use-search-overlay";

/**
 * The brand's search overlay: the header's search link, plus a dialog with a search field and the
 * bounded suggestions the server returns. Markup and copy only.
 *
 * The field is a real search form that submits to `/shop`, so pressing Enter or "Tìm kiếm" always
 * works, with or without suggestions. The suggestions are the server's `SearchSuggestionsModel`:
 * price text, availability and the PDP path are the product card's own. Without JavaScript, or with
 * a modified click, the header link is simply the link to `/search` it always was.
 */

const buttonClassName =
  "inline-flex min-h-11 min-w-11 items-center justify-center border border-black/30 px-3 text-xs font-semibold uppercase tracking-[0.12em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

export function SearchOverlayTrigger({ href, label }: Readonly<{ href: string; label: string }>) {
  const triggerRef = useRef<HTMLAnchorElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const overlay = useSearchOverlay({ triggerRef, dialogRef, inputRef, listRef });
  const { announcement } = overlay;

  const statusText =
    announcement === null
      ? ""
      : announcement.kind === "loading"
        ? "Đang tìm…"
        : announcement.kind === "results"
          ? `Có ${announcement.total} sản phẩm phù hợp.`
          : announcement.kind === "empty"
            ? "Không có sản phẩm phù hợp."
            : "Không thể tải gợi ý lúc này. Bạn vẫn có thể bấm Tìm kiếm để xem kết quả.";

  return (
    <>
      <Link ref={triggerRef} href={href} onClick={overlay.onTriggerClick}>
        {label}
      </Link>

      {overlay.open ? (
        <BodyPortal>
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={overlay.close} />
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={overlay.titleId}
              onKeyDown={overlay.onDialogKeyDown}
              className="absolute inset-x-0 top-0 flex max-h-full flex-col bg-white shadow-xl"
            >
              <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 pt-4">
                <h2 id={overlay.titleId} className="font-serif text-2xl tracking-[-0.03em]">
                  Tìm kiếm
                </h2>
                <button type="button" className={buttonClassName} onClick={overlay.close}>
                  Đóng<span className="sr-only"> tìm kiếm</span>
                </button>
              </div>

              <form
                action="/shop"
                method="get"
                role="search"
                className="mx-auto mt-4 flex w-full max-w-3xl border-b border-black px-5"
              >
                <label className="sr-only" htmlFor={`${overlay.listId}-q`}>
                  Tìm sản phẩm
                </label>
                <input
                  ref={inputRef}
                  id={`${overlay.listId}-q`}
                  name="q"
                  type="search"
                  autoComplete="off"
                  maxLength={overlay.limits.maxQueryLength}
                  placeholder="Sơ mi, quần, áo khoác…"
                  value={overlay.query}
                  onChange={overlay.onInputChange}
                  className="min-w-0 flex-1 bg-transparent py-4 text-xl outline-none placeholder:text-black/40 focus-visible:outline-2 focus-visible:outline-offset-4"
                />
                <button
                  type="submit"
                  className="px-4 text-xs font-semibold uppercase tracking-[0.14em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                >
                  Tìm kiếm
                </button>
              </form>

              <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto px-5 py-4">
                {overlay.status === "short" ? (
                  <p className="text-sm text-black/65">
                    Nhập ít nhất {overlay.limits.minQueryLength} ký tự để xem gợi ý.
                  </p>
                ) : (
                  <p role="status" className="text-sm text-black/65">
                    {statusText}
                  </p>
                )}

                {overlay.result && overlay.result.items.length > 0 ? (
                  <>
                    <ul ref={listRef} aria-label="Gợi ý sản phẩm" className="mt-4 grid gap-4">
                      {overlay.result.items.map((item) => (
                        <li key={item.key}>
                          <Link href={item.href} onClick={overlay.close} className="flex gap-4 hover:underline">
                            <span className="relative block h-20 w-16 shrink-0 overflow-hidden bg-black/5">
                              {item.image ? (
                                <Image src={item.image.url} alt="" fill sizes="64px" className="object-cover" />
                              ) : null}
                            </span>
                            <span className="min-w-0 text-sm">
                              <span className="block font-medium">{item.name}</span>
                              <span className="mt-1 block">
                                {item.compareAtText ? (
                                  <span className="mr-2 text-black/60 line-through">{item.compareAtText}</span>
                                ) : null}
                                {item.priceText}
                              </span>
                              {item.availability === "out-of-stock" ? (
                                <span className="mt-1 block text-black/65">Hết hàng</span>
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={overlay.result.seeAllHref}
                      onClick={overlay.close}
                      className={`${buttonClassName} mt-6 w-full`}
                    >
                      Xem tất cả {overlay.result.totalCount} sản phẩm
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </BodyPortal>
      ) : null}
    </>
  );
}

/** Under `document.body` so the header's `nav a` rules cannot reach the dialog's links (see the cart drawer). */
function BodyPortal({ children }: Readonly<{ children: ReactNode }>) {
  return createPortal(children, document.body);
}
