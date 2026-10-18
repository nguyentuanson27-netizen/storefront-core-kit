/**
 * Boundary parsing for the benefit-campaign admin form (A06). Pure: strings in, a draft with
 * *references still unresolved* out. Product slugs and gift variant references are resolved against
 * the catalog by the server action, so this module never touches the database.
 *
 * Every field is untrusted. Blank rows are skipped, numbers must be plain base-10 integers, and a value
 * that does not parse is a typed refusal, never silently coerced into a different amount.
 */

import {
  BENEFIT_MAX_GIFTS,
  BENEFIT_MAX_GIFT_QUANTITY,
  BENEFIT_MAX_TARGETS,
  BENEFIT_MAX_TIERS,
  type BenefitCampaignKind,
} from "./benefit-campaign.ts";
import { parseStrictVietnamDateTime } from "./promotion-admin-input.ts";

export type BenefitFormFields = Readonly<{
  kind: unknown;
  name: unknown;
  startsAt: unknown;
  endsAt: unknown;
  thresholdKind: unknown;
  productSlugs: unknown;
  tierThresholds: readonly unknown[];
  tierPercents: readonly unknown[];
  giftRefs: readonly unknown[];
  giftQuantities: readonly unknown[];
}>;

export type ParsedBenefitForm = Readonly<{
  kind: BenefitCampaignKind;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  productSlugs: readonly string[];
  tiers: readonly Readonly<{
    thresholdQuantity: number | null;
    thresholdSubtotalVnd: number | null;
    percentageValue: number | null;
  }>[];
  gifts: readonly Readonly<{ ref: string; quantity: number }>[];
}>;

export type BenefitFormRefusal =
  | "INVALID_KIND"
  | "INVALID_NAME"
  | "INVALID_DATE_TIME"
  | "INVALID_TARGETS"
  | "INVALID_TIERS"
  | "INVALID_GIFTS";

export type BenefitFormParse =
  | Readonly<{ ok: true; form: ParsedBenefitForm }>
  | Readonly<{ ok: false; reason: BenefitFormRefusal }>;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** A positive base-10 integer in the safe range, or null. */
function wholeNumber(value: unknown): number | null | undefined {
  const raw = text(value);
  if (raw === "") return undefined;
  if (!/^[0-9]{1,15}$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function slugList(value: unknown): string[] {
  const seen = new Set<string>();
  for (const part of text(value).split(/[\s,;]+/)) {
    if (part !== "") seen.add(part);
    // Bounded: stop once the limit is exceeded so the validator can refuse, without unbounded work.
    if (seen.size > BENEFIT_MAX_TARGETS) break;
  }
  return [...seen];
}

export function parseBenefitCampaignForm(fields: BenefitFormFields): BenefitFormParse {
  const kind = text(fields.kind);
  if (kind !== "GIFT_ITEM" && kind !== "QUANTITY_TIER") return { ok: false, reason: "INVALID_KIND" };

  const name = text(fields.name);
  if (name === "") return { ok: false, reason: "INVALID_NAME" };

  const startsAt = parseStrictVietnamDateTime(fields.startsAt);
  const endsAt = parseStrictVietnamDateTime(fields.endsAt);
  if (!startsAt.ok || !endsAt.ok) return { ok: false, reason: "INVALID_DATE_TIME" };

  const thresholdKind = text(fields.thresholdKind);
  if (thresholdKind !== "QUANTITY" && thresholdKind !== "SUBTOTAL") return { ok: false, reason: "INVALID_TIERS" };

  const tiers: Array<ParsedBenefitForm["tiers"][number]> = [];
  const rows = Math.min(
    Math.max(fields.tierThresholds.length, fields.tierPercents.length),
    BENEFIT_MAX_TIERS + 1,
  );
  for (let index = 0; index < rows; index += 1) {
    const threshold = wholeNumber(fields.tierThresholds[index]);
    const percent = wholeNumber(fields.tierPercents[index]);
    if (threshold === undefined && percent === undefined) continue; // blank row
    if (threshold === null || threshold === undefined) return { ok: false, reason: "INVALID_TIERS" };
    if (percent === null) return { ok: false, reason: "INVALID_TIERS" };
    tiers.push({
      thresholdQuantity: thresholdKind === "QUANTITY" ? threshold : null,
      thresholdSubtotalVnd: thresholdKind === "SUBTOTAL" ? threshold : null,
      percentageValue: kind === "QUANTITY_TIER" ? (percent ?? null) : null,
    });
  }
  // A price step needs a percentage; a gift step must not carry one (the database enforces the same).
  if (kind === "QUANTITY_TIER" && tiers.some((tier) => tier.percentageValue === null)) {
    return { ok: false, reason: "INVALID_TIERS" };
  }

  const gifts: Array<ParsedBenefitForm["gifts"][number]> = [];
  const giftRows = Math.min(
    Math.max(fields.giftRefs.length, fields.giftQuantities.length),
    BENEFIT_MAX_GIFTS + 1,
  );
  for (let index = 0; index < giftRows; index += 1) {
    const ref = text(fields.giftRefs[index]);
    const quantity = wholeNumber(fields.giftQuantities[index]);
    if (ref === "" && quantity === undefined) continue;
    if (ref === "" || ref.length > 64 || quantity === null || quantity === undefined) {
      return { ok: false, reason: "INVALID_GIFTS" };
    }
    if (quantity > BENEFIT_MAX_GIFT_QUANTITY) return { ok: false, reason: "INVALID_GIFTS" };
    gifts.push({ ref, quantity });
  }
  if (kind === "QUANTITY_TIER" && gifts.length > 0) return { ok: false, reason: "INVALID_GIFTS" };

  return {
    ok: true,
    form: {
      kind,
      name,
      startsAt: startsAt.date,
      endsAt: endsAt.date,
      productSlugs: slugList(fields.productSlugs),
      tiers,
      gifts,
    },
  };
}
