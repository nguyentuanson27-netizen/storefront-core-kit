/**
 * Page grammar and arithmetic for the curated New Arrivals listing (B1, accepted GB1 technical review:
 * docs/specs/core-kit-new-arrivals-curation-v1-technical-review.md §1).
 *
 * Pure: the parser rejects out-of-bound values before any database read can happen, and the paging
 * arithmetic works on *stored slots*, not on what survives hiding, so a hidden product never changes
 * where a page boundary falls.
 */

/** Owner-approved: the same nominal page size as `/shop`, held as its own constant. */
export const NEW_ARRIVALS_PAGE_SIZE = 24;
/** Owner-approved ceiling on persisted curated slots; the database enforces it too. */
export const NEW_ARRIVALS_MAX_ITEMS = 500;
/** Derived, never hard-coded: 500 slots at 24 per page is 21 pages. */
export const NEW_ARRIVALS_MAX_PAGES = Math.ceil(NEW_ARRIVALS_MAX_ITEMS / NEW_ARRIVALS_PAGE_SIZE);

export const NEW_ARRIVALS_BASE_PATH = "/new-arrivals";

export type NewArrivalsPageParse = Readonly<{ ok: true; page: number }> | Readonly<{ ok: false }>;

/**
 * `?page=` as Next hands it over. Absent or empty is page 1 (as `/shop` treats it); a canonical
 * positive integer within the derived bound is that page; everything else — zero, negatives, leading
 * zeros, fractions, exponents, signs, whitespace, repeated parameters, anything past page 21 — is a
 * 404 decided without reading the database.
 */
export function parseNewArrivalsPage(value: string | readonly string[] | undefined): NewArrivalsPageParse {
  if (value === undefined) return { ok: true, page: 1 };
  if (typeof value !== "string") return { ok: false };
  if (value === "") return { ok: true, page: 1 };
  if (!/^[1-9][0-9]*$/.test(value)) return { ok: false };

  const page = Number(value);
  if (!Number.isSafeInteger(page) || page > NEW_ARRIVALS_MAX_PAGES) return { ok: false };
  return { ok: true, page };
}

export type NewArrivalsPaging = Readonly<{
  /** At least 1: an empty selection still has the one editorial/empty page. */
  totalPages: number;
  /** Zero-based rank of the first stored slot on this page. */
  offset: number;
  limit: number;
}>;

/** `null` when `page` lies beyond the stored slots, which the route turns into a 404. */
export function computeNewArrivalsPaging(selectionCount: number, page: number): NewArrivalsPaging | null {
  if (
    !Number.isSafeInteger(selectionCount) ||
    selectionCount < 0 ||
    selectionCount > NEW_ARRIVALS_MAX_ITEMS ||
    !Number.isSafeInteger(page) ||
    page < 1
  ) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(selectionCount / NEW_ARRIVALS_PAGE_SIZE));
  if (page > totalPages) return null;
  return { totalPages, offset: (page - 1) * NEW_ARRIVALS_PAGE_SIZE, limit: NEW_ARRIVALS_PAGE_SIZE };
}

/** Page 1 is the bare path; later pages carry `?page=N`. */
export function newArrivalsPagePath(page: number): string {
  return page <= 1 ? NEW_ARRIVALS_BASE_PATH : `${NEW_ARRIVALS_BASE_PATH}?page=${page}`;
}
