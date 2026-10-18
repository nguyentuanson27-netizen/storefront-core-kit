/**
 * The admin curator's edit rules for the curated new-arrivals selection (B02). Pure: it turns untrusted form
 * fields into a bounded, validated ordered list, and never decides authorization or touches storage —
 * the Server Action re-authorizes and the repository enforces the revision and the database ceiling.
 *
 * Nothing the browser sends is trusted for shape or size. Every id, position and revision is bounded
 * and parsed strictly; anything else is `INVALID`, which the page reports as one typed message.
 */

import { NEW_ARRIVALS_MAX_ITEMS } from "./new-arrivals-paging.ts";

/** `ProductMirror.id` is a cuid; this only keeps a hostile field from being arbitrarily large. */
export const NEW_ARRIVALS_MAX_PRODUCT_ID_LENGTH = 64;
const MAX_REVISION_DIGITS = 18;

export type NewArrivalsAdminReason =
  | "INVALID"
  | "TOO_MANY"
  | "DUPLICATE_PRODUCT"
  | "UNKNOWN_PRODUCT"
  | "STALE_REVISION"
  | "ALREADY_PRESENT";

export const NEW_ARRIVALS_ADMIN_MESSAGES: Readonly<Record<NewArrivalsAdminReason, string>> = {
  INVALID: "Dữ liệu không hợp lệ. Tải lại trang rồi thử lại.",
  TOO_MANY: `Danh sách hàng mới chỉ chứa tối đa ${NEW_ARRIVALS_MAX_ITEMS} sản phẩm.`,
  DUPLICATE_PRODUCT: "Một sản phẩm không thể xuất hiện hai lần trong danh sách.",
  UNKNOWN_PRODUCT: "Có sản phẩm không còn tồn tại. Tải lại trang rồi thử lại.",
  STALE_REVISION: "Danh sách vừa được người khác thay đổi. Tải lại trang để xem bản mới nhất.",
  ALREADY_PRESENT: "Sản phẩm này đã có trong danh sách.",
};

/** The closed set of `?error=` values the page will render; anything else collapses to `INVALID`. */
export function readNewArrivalsAdminReason(value: unknown): NewArrivalsAdminReason {
  return typeof value === "string" && Object.hasOwn(NEW_ARRIVALS_ADMIN_MESSAGES, value)
    ? (value as NewArrivalsAdminReason)
    : "INVALID";
}

/** Canonical decimal only: no sign, no leading zeros, no exponent, bounded to fit a BIGINT. */
export function parseNewArrivalsRevision(raw: unknown): bigint | null {
  if (typeof raw !== "string") return null;
  if (!new RegExp(`^(0|[1-9][0-9]{0,${MAX_REVISION_DIGITS - 1}})$`).test(raw)) return null;
  return BigInt(raw);
}

function isProductId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= NEW_ARRIVALS_MAX_PRODUCT_ID_LENGTH
  );
}

function parsePosition(raw: unknown): number | null | "INVALID" {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,2}$/.test(raw)) return "INVALID";
  const position = Number(raw);
  return position <= NEW_ARRIVALS_MAX_ITEMS ? position : "INVALID";
}

export type NewArrivalsOrderInput = Readonly<{
  revision: unknown;
  /** Hidden field per row, in the order the page rendered them. */
  productIds: readonly unknown[];
  /** One entry per row (blank keeps the row where it is). */
  positions: readonly unknown[];
  /** Product ids ticked for removal. */
  removals: readonly unknown[];
}>;

export type NewArrivalsEditPlan =
  | Readonly<{ ok: true; revision: bigint; productIds: string[] }>
  | Readonly<{ ok: false; reason: NewArrivalsAdminReason }>;

/**
 * Applies the editor's position numbers and removals to the rendered rows. A blank position keeps
 * the row's current place; ties keep their rendered order, so saving without touching anything is a
 * no-op on the order.
 */
export function planNewArrivalsOrder(input: NewArrivalsOrderInput): NewArrivalsEditPlan {
  const revision = parseNewArrivalsRevision(input.revision);
  if (revision === null) return { ok: false, reason: "INVALID" };
  if (
    !Array.isArray(input.productIds) ||
    !Array.isArray(input.positions) ||
    !Array.isArray(input.removals) ||
    input.productIds.length > NEW_ARRIVALS_MAX_ITEMS ||
    input.positions.length !== input.productIds.length ||
    input.removals.length > NEW_ARRIVALS_MAX_ITEMS ||
    !input.productIds.every(isProductId) ||
    !input.removals.every(isProductId)
  ) {
    return { ok: false, reason: "INVALID" };
  }

  const ids = input.productIds as string[];
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "DUPLICATE_PRODUCT" };
  const removed = new Set(input.removals as string[]);

  const rows: { productId: string; key: number; index: number }[] = [];
  for (const [index, productId] of ids.entries()) {
    const position = parsePosition(input.positions[index]);
    if (position === "INVALID") return { ok: false, reason: "INVALID" };
    if (removed.has(productId)) continue;
    rows.push({ productId, key: position ?? index + 1, index });
  }
  rows.sort((left, right) => left.key - right.key || left.index - right.index);
  return { ok: true, revision, productIds: rows.map(({ productId }) => productId) };
}

export function planNewArrivalsAppend(input: Readonly<{
  revision: unknown;
  /** The current order as the page rendered it. */
  productIds: readonly unknown[];
  productId: unknown;
}>): NewArrivalsEditPlan {
  const revision = parseNewArrivalsRevision(input.revision);
  if (revision === null || !isProductId(input.productId)) return { ok: false, reason: "INVALID" };
  if (!Array.isArray(input.productIds) || !input.productIds.every(isProductId)) {
    return { ok: false, reason: "INVALID" };
  }

  const current = input.productIds as string[];
  if (current.includes(input.productId)) return { ok: false, reason: "ALREADY_PRESENT" };
  if (current.length >= NEW_ARRIVALS_MAX_ITEMS) return { ok: false, reason: "TOO_MANY" };
  return { ok: true, revision, productIds: [...current, input.productId] };
}
