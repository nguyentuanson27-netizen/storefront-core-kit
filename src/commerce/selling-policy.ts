/**
 * Selling policy: the pure rules (spec: docs/specs/core-kit-selling-modes-v1.md §4).
 *
 * Every product has exactly one website-owned mode. `STANDARD` sells down to 0, `OVERSELL` and
 * `PREORDER` down to the product's `negativeStockLimit`, enforced independently per variant. This
 * module owns the two answers every consumer must share rather than re-derive:
 *
 * 1. `resolveSellingPolicy()` — what the stored row (or its absence) means;
 * 2. `effectivePolicy()` — what a sale decision may use, after validation and the capability flags.
 *
 * Nothing here reads the database or the environment. The repository reads rows, `readSellingModeFlags`
 * turns an environment into flags, and callers hand both in.
 */

export const SELLING_MODES = ["STANDARD", "OVERSELL", "PREORDER"] as const;
export type SellingMode = (typeof SELLING_MODES)[number];

/** Owner-approved default (spec §14 Q3), product-level only. */
export const DEFAULT_NEGATIVE_STOCK_LIMIT = -20;
/** Mirrors the migration's CHECK. The resolver re-checks it so a bad row fails closed, not open. */
export const MIN_NEGATIVE_STOCK_LIMIT = -100_000;
export const MAX_NEGATIVE_STOCK_LIMIT = 0;

export type StoredSellingPolicy = Readonly<{
  sellingMode: string;
  negativeStockLimit: number;
}>;

export type ResolvedSellingPolicy = Readonly<{
  sellingMode: SellingMode;
  negativeStockLimit: number;
  /** No stored row: the defaults were applied. */
  isDefault: boolean;
  /** False only when a stored limit is outside the accepted range; every sale then refuses. */
  valid: boolean;
}>;

export function isValidNegativeStockLimit(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= MIN_NEGATIVE_STOCK_LIMIT
    && value <= MAX_NEGATIVE_STOCK_LIMIT
  );
}

function isSellingMode(value: unknown): value is SellingMode {
  return typeof value === "string" && (SELLING_MODES as readonly string[]).includes(value);
}

/**
 * What a stored policy row means (spec §4.2).
 *
 * - No row → `STANDARD` with the default limit: exactly today's behaviour. A column default cannot
 *   supply this, because the database never invents the row.
 * - An unknown mode → `STANDARD`. No owner intent survives in a value that names no mode, and the
 *   stored limit is kept so no allowance is silently widened.
 * - A limit outside `[−100000, 0]` is returned as stored with `valid: false`. Substituting the
 *   default would sell under a limit nobody set; refusing sends the operator to the wrong row.
 */
export function resolveSellingPolicy(stored: StoredSellingPolicy | null | undefined): ResolvedSellingPolicy {
  if (stored === null || stored === undefined) {
    return Object.freeze({
      sellingMode: "STANDARD",
      negativeStockLimit: DEFAULT_NEGATIVE_STOCK_LIMIT,
      isDefault: true,
      valid: true,
    });
  }
  return Object.freeze({
    sellingMode: isSellingMode(stored.sellingMode) ? stored.sellingMode : "STANDARD",
    negativeStockLimit: stored.negativeStockLimit,
    isDefault: false,
    valid: isValidNegativeStockLimit(stored.negativeStockLimit),
  });
}

export type SellingModeFlags = Readonly<{
  /** The whole capability. Off from M1 through M3 (spec §13). */
  sellingModesEnabled: boolean;
  /** `PREORDER` additionally; off until Preorder truth v1 (spec §10.2). */
  preorderEnabled: boolean;
}>;

export const SELLING_MODE_FLAGS_OFF: SellingModeFlags = Object.freeze({
  sellingModesEnabled: false,
  preorderEnabled: false,
});

/**
 * Reads the two capability flags. Only the exact string `true` turns one on, so a typo, an empty
 * value or an unset variable all mean off — the conservative direction.
 */
export function readSellingModeFlags(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SellingModeFlags {
  return Object.freeze({
    sellingModesEnabled: env.SELLING_MODES_ENABLED === "true",
    preorderEnabled: env.SELLING_MODE_PREORDER_ENABLED === "true",
  });
}

/** `STANDARD` never goes below 0; the limit is an allowance for the other two modes only. */
export function capacityFloor(mode: SellingMode, negativeStockLimit: number): number {
  return mode === "STANDARD" ? 0 : negativeStockLimit;
}

export type EffectiveSellingPolicy =
  | Readonly<{ kind: "REFUSE"; reason: "INVALID_POLICY"; stored: ResolvedSellingPolicy }>
  | Readonly<{
      kind: "SELL";
      mode: SellingMode;
      floor: number;
      /** Why the effective mode differs from the stored one, or `null` when it does not. */
      downgrade: null | "SELLING_MODES_DISABLED" | "PREORDER_DISABLED";
      stored: ResolvedSellingPolicy;
    }>;

/**
 * The policy a sale decision uses (spec §4.2.1). One authority order, validation first:
 *
 * 1. an invalid stored row refuses every decision, whatever the flags say — a disabled capability
 *    must not turn a corrupt row back into a `STANDARD` sale;
 * 2. with the capability off, every valid policy is effectively `STANDARD`;
 * 3. a stored `PREORDER` with the preorder flag off is effectively `STANDARD`, so a row saved while
 *    the flag was on stops affecting sales the moment it is turned off;
 * 4. otherwise the stored policy, as resolved.
 *
 * Every downgrade is toward floor 0, the conservative direction, and is reported so an operator can
 * see which products are not selling the way they were configured.
 */
export function effectivePolicy(
  stored: StoredSellingPolicy | null | undefined,
  flags: SellingModeFlags,
): EffectiveSellingPolicy {
  const resolved = resolveSellingPolicy(stored);
  if (!resolved.valid) return Object.freeze({ kind: "REFUSE", reason: "INVALID_POLICY", stored: resolved });

  const standard = (downgrade: "SELLING_MODES_DISABLED" | "PREORDER_DISABLED") =>
    Object.freeze({ kind: "SELL" as const, mode: "STANDARD" as const, floor: 0, downgrade, stored: resolved });

  if (resolved.sellingMode !== "STANDARD" && !flags.sellingModesEnabled) {
    return standard("SELLING_MODES_DISABLED");
  }
  if (resolved.sellingMode === "PREORDER" && !flags.preorderEnabled) return standard("PREORDER_DISABLED");

  return Object.freeze({
    kind: "SELL",
    mode: resolved.sellingMode,
    floor: capacityFloor(resolved.sellingMode, resolved.negativeStockLimit),
    downgrade: null,
    stored: resolved,
  });
}

/** Admin input: what a submission asks for, before any authorization or product checks. */
export type SellingPolicyChange =
  | Readonly<{ kind: "RESET" }>
  | Readonly<{ kind: "SET"; sellingMode: SellingMode; negativeStockLimit: number }>;

/** The value the admin form submits to go back to "no row" (spec §4.2 default). */
export const SELLING_POLICY_RESET = "DEFAULT";

/**
 * Parses an admin submission. Strict: the limit must be a canonical integer string in range, with no
 * whitespace, sign games or exponent notation, so what the operator typed is exactly what is stored.
 */
export function parseSellingPolicyChange(
  input: Readonly<{ sellingMode: unknown; negativeStockLimit: unknown }>,
): SellingPolicyChange | null {
  if (input.sellingMode === SELLING_POLICY_RESET) return Object.freeze({ kind: "RESET" });
  if (!isSellingMode(input.sellingMode)) return null;

  const raw = input.negativeStockLimit;
  if (typeof raw !== "string" || !/^(0|-[1-9][0-9]{0,5})$/.test(raw)) return null;
  const limit = Number(raw);
  if (!isValidNegativeStockLimit(limit)) return null;

  return Object.freeze({ kind: "SET", sellingMode: input.sellingMode, negativeStockLimit: limit });
}
