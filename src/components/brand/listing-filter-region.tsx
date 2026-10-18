"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";

import { usePlpFilterDisclosure } from "@/components/headless/use-plp-filter-disclosure";
import {
  buildPlpFilterSummary,
  buildPlpResultAnnouncement,
} from "@/components/headless/plp-filter-model";

/**
 * The brand's presentation of the headless filter region: a collapse button below the wide
 * breakpoint, the applied-filter chips and a polite result announcement.
 *
 * The form is passed in as `children` and stays server-rendered; the chip hrefs are the route's own.
 * Before hydration the panel is visible and the button is absent, so this renders as the plain
 * always-open form the page had before.
 */

type ActiveFilter = Readonly<{ value: string | null; label: string; href: string }>;

export function ListingFilterRegion({
  stateKey,
  activeFilters,
  totalCount,
  wideQuery,
  triggerClassName,
  chipClassName,
  children,
}: Readonly<{
  stateKey: string;
  activeFilters: readonly ActiveFilter[];
  totalCount: number;
  wideQuery: string;
  triggerClassName: string;
  chipClassName: string;
  children: ReactNode;
}>) {
  const chipKeys = activeFilters.flatMap((filter) => (filter.value === null ? [] : [filter.value]));
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef<HTMLUListElement | null>(null);
  const disclosure = usePlpFilterDisclosure({
    stateKey,
    wideQuery,
    chipKeys,
    triggerRef,
    panelRef,
    chipsRef,
  });
  const summary = buildPlpFilterSummary(activeFilters);
  const announcement = buildPlpResultAnnouncement(totalCount);

  return (
    <>
      {disclosure.triggerVisible ? (
        <button
          ref={triggerRef}
          {...disclosure.triggerProps}
          className={triggerClassName}
          aria-label={summary.hasActive ? `Bộ lọc, ${summary.activeCount} đang áp dụng` : "Bộ lọc"}
        >
          Bộ lọc{summary.hasActive ? ` (${summary.activeCount})` : ""}
        </button>
      ) : null}

      {activeFilters.length > 0 ? (
        <ul className="mt-6 flex flex-wrap gap-3" aria-label="Bộ lọc đang áp dụng" ref={chipsRef}>
          {activeFilters.map((filter) => (
            <li key={filter.value ?? filter.href}>
              <Link
                className={chipClassName}
                data-plp-chip={filter.value ?? undefined}
                href={filter.href}
                scroll={false}
                aria-label={`Bỏ lọc ${filter.label}`}
                onClick={() => {
                  if (filter.value !== null) disclosure.noteChipRemoval(filter.value);
                }}
              >
                {filter.label}
                <span aria-hidden="true">×</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div ref={panelRef} {...disclosure.panelProps}>
        {children}
      </div>

      <p className="sr-only" role="status">
        {announcement.kind === "results"
          ? `Có ${announcement.count} sản phẩm phù hợp.`
          : "Không có sản phẩm phù hợp."}
      </p>
    </>
  );
}
