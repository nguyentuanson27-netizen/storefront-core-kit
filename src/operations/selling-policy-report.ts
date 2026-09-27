/**
 * The selling-policy operator report (spec: docs/specs/core-kit-selling-modes-v1.md §10.3).
 *
 * Pure: it turns repository rows and the deployment's flags into lines, so what an operator sees is
 * exactly what `effectivePolicy()` decides. It prints product slugs and variant ids only, no PII.
 */

import type { SellingPolicyReportRow } from "../commerce/selling-policy-repository.ts";
import { effectivePolicy, type SellingModeFlags } from "../commerce/selling-policy.ts";

export type SellingPolicyReportFlag =
  | "INVALID_POLICY"
  | "SELLING_MODES_DISABLED"
  | "PREORDER_DISABLED"
  | "COMPOSITE_MODE_UNSUPPORTED"
  | "AT_OR_BELOW_FLOOR";

export type SellingPolicyReportVariantLine = Readonly<{
  variantId: string;
  freeUnits: number | null;
  sellableUnits: number | null;
  readyUnits: number | null;
  atOrBelowFloor: boolean;
}>;

export type SellingPolicyReportProductLine = Readonly<{
  productSlug: string;
  storedMode: string;
  storedLimit: number;
  effectiveMode: string;
  floor: number | null;
  flags: readonly SellingPolicyReportFlag[];
  variants: readonly SellingPolicyReportVariantLine[];
}>;

export function buildSellingPolicyReport(
  rows: readonly SellingPolicyReportRow[],
  flags: SellingModeFlags,
): SellingPolicyReportProductLine[] {
  return rows.map((row) => {
    const effective = effectivePolicy(row.stored, flags);
    const reportFlags = new Set<SellingPolicyReportFlag>();
    if (effective.kind === "REFUSE") reportFlags.add("INVALID_POLICY");
    else if (effective.downgrade !== null) reportFlags.add(effective.downgrade);

    const hasCompositeParent = row.variants.some((variant) => variant.isCompositeParent);
    if (hasCompositeParent && effective.stored.sellingMode !== "STANDARD") reportFlags.add("COMPOSITE_MODE_UNSUPPORTED");

    const floor = effective.kind === "SELL" ? effective.floor : null;
    const variants = row.variants.map((variant) => {
      const freeUnits = variant.mirroredUnits === null ? null : variant.mirroredUnits - variant.activeReservedUnits;
      const sellableUnits = freeUnits === null || floor === null ? null : Math.max(0, freeUnits - floor);
      const atOrBelowFloor = freeUnits !== null && floor !== null && freeUnits <= floor;
      if (atOrBelowFloor) reportFlags.add("AT_OR_BELOW_FLOOR");
      return {
        variantId: variant.variantId,
        freeUnits,
        sellableUnits,
        readyUnits: freeUnits === null ? null : Math.max(0, freeUnits),
        atOrBelowFloor,
      };
    });

    return {
      productSlug: row.productSlug,
      storedMode: row.stored.sellingMode,
      storedLimit: row.stored.negativeStockLimit,
      effectiveMode: effective.kind === "SELL" ? effective.mode : "REFUSE",
      floor,
      flags: [...reportFlags].sort(),
      variants,
    };
  });
}

export function formatSellingPolicyReport(
  lines: readonly SellingPolicyReportProductLine[],
  flags: SellingModeFlags,
): string {
  const out = [
    `selling modes: ${flags.sellingModesEnabled ? "enabled" : "disabled"}; preorder: ${flags.preorderEnabled ? "enabled" : "disabled"}`,
    `${lines.length} product(s) with a stored policy`,
  ];
  for (const line of lines) {
    out.push(
      `${line.productSlug}: stored ${line.storedMode} ${line.storedLimit} → effective ${line.effectiveMode}`
        + `${line.floor === null ? "" : ` (floor ${line.floor})`}${line.flags.length ? ` [${line.flags.join(", ")}]` : ""}`,
    );
    for (const variant of line.variants) {
      out.push(
        `  ${variant.variantId}: free ${variant.freeUnits ?? "?"}, sellable ${variant.sellableUnits ?? "?"}, ready ${variant.readyUnits ?? "?"}`
          + (variant.atOrBelowFloor ? " (at or below floor)" : ""),
      );
    }
  }
  return out.join("\n");
}
