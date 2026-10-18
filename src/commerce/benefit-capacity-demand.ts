/**
 * What a benefit quote asks the capacity ledger to hold. A03 of the Core Kit A/B/C programme.
 *
 * `CapacityReservation` is `@@unique([orderId, variantId])`, so PAID X ×1 and GIFT X ×1 cannot be
 * two reservation rows: they are one demand of 2 on the same variant. `reserveOrderCapacity` already
 * merges duplicate purchased variants before it evaluates anything (`planCapacityResources`), so the
 * locking, the composite expansion, the selling floors and the all-or-none decision are the existing
 * ones and are not restated here. This module only derives the reservation input from signed role
 * lines, so the quantity held is computed from the same lines the proof attests to and a gift can
 * never be left out of what is reserved.
 *
 * Pure and unwired: nothing calls it until A04/A08.
 */

export type BenefitDemandLine = Readonly<{
  role: "PAID" | "GIFT";
  variantId: string;
  quantity: number;
}>;

export type CapacityDemandLine = Readonly<{ variantId: string; quantity: number }>;

/**
 * Sums every role line per variant, in ascending variant order so the result is deterministic.
 * Throws `RangeError` for a line that cannot be a real demand; a caller that reaches here with one
 * has a bug upstream, and reserving "what was left" would be reserving the wrong thing.
 */
export function aggregateBenefitCapacityDemand(
  lines: readonly BenefitDemandLine[],
): CapacityDemandLine[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new RangeError("A benefit order needs at least one line to reserve");
  }

  const totals = new Map<string, number>();
  for (const line of lines) {
    if (line.role !== "PAID" && line.role !== "GIFT") {
      throw new RangeError("A capacity demand line needs a PAID or GIFT role");
    }
    if (typeof line.variantId !== "string" || line.variantId.length === 0) {
      throw new RangeError("A capacity demand line needs a variant");
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError("A capacity demand line needs a positive safe-integer quantity");
    }
    const total = (totals.get(line.variantId) ?? 0) + line.quantity;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("A capacity demand total exceeds the safe-integer range");
    }
    totals.set(line.variantId, total);
  }

  return [...totals.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([variantId, quantity]) => ({ variantId, quantity }));
}
