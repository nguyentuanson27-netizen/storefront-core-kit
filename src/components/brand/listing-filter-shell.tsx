import Link from "next/link";
import type { ReactNode } from "react";

import { ListingFilterRegion } from "./listing-filter-region.tsx";

/**
 * Chooses between the always-open filter form and the collapsible one.
 *
 * Off, this is the markup `/shop` has always rendered -- the applied-filter chips, then the form --
 * with no client component in the tree. On, the same chips and form go inside `ListingFilterRegion`.
 * The form is passed as `children` either way, so it is written once and stays server-rendered.
 */

type ActiveFilter = Readonly<{ value: string | null; label: string; href: string }>;

export function ListingFilterShell({
  enabled,
  stateKey,
  activeFilters,
  totalCount,
  wideQuery,
  triggerClassName,
  chipClassName,
  children,
}: Readonly<{
  enabled: boolean;
  stateKey: string;
  activeFilters: readonly ActiveFilter[];
  totalCount: number;
  wideQuery: string;
  triggerClassName: string;
  chipClassName: string;
  children: ReactNode;
}>) {
  if (enabled) {
    return (
      <ListingFilterRegion
        stateKey={stateKey}
        activeFilters={activeFilters}
        totalCount={totalCount}
        wideQuery={wideQuery}
        triggerClassName={triggerClassName}
        chipClassName={chipClassName}
      >
        {children}
      </ListingFilterRegion>
    );
  }

  return (
    <>
      {activeFilters.length > 0 ? (
        <ul className="mt-6 flex flex-wrap gap-3" aria-label="Bộ lọc đang áp dụng">
          {activeFilters.map((filter) => (
            <li key={filter.value ?? filter.href}>
              <Link
                className={chipClassName}
                href={filter.href}
                scroll={false}
                aria-label={`Bỏ lọc ${filter.label}`}
              >
                {filter.label}
                <span aria-hidden="true">×</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {children}
    </>
  );
}
