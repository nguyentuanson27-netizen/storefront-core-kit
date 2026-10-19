import type { PrismaClient } from "../generated/prisma/client.ts";
import type { PancakeCatalogVariation } from "../integrations/pancake/catalog-contract.ts";
import {
  buildPancakeCreateOrderRequest,
  parsePancakeCreateOrderResponse,
  type PancakeCreateOrderRequest,
} from "../integrations/pancake/order-create.ts";
import { ANONYMOUS_CART_MAX_DISTINCT_ITEMS } from "./anonymous-cart.ts";
import { markOrderCapacityAccepted, reserveOrderCapacity } from "./capacity-reservation-repository.ts";
import { SYNC_TRANSACTION_TIMEOUT_MS } from "./catalog-mirror-repository.ts";
import { calculateGuestShippingFeeVnd } from "./guest-shipping-policy.ts";
import { readApplicablePromotionCampaignsBatched } from "./promotion-candidate-batching.ts";
import type {
  ApplicableCampaignLookup,
  PromotionCandidateReadClient,
} from "./promotion-candidate-repository.ts";
import { isUsableBasePriceVnd, resolvePromotionPricing } from "./promotion-pricing.ts";
import { readSellingModeFlags, type EffectiveSellingPolicy, type SellingModeFlags } from "./selling-policy.ts";
import { readEffectiveSellingPolicies } from "./selling-policy-repository.ts";

const MAX_PUBLIC_CODE_LENGTH = 128;

export type PancakeOrderSubmissionReason =
  | "ORDER_NOT_FOUND"
  | "SUBMISSION_ALREADY_CLAIMED"
  | "SUBMISSION_BUSY"
  | "LOCAL_ORDER_INVALID"
  | "SHOP_SCOPE_UNVERIFIED"
  | "VARIATION_UNAVAILABLE"
  | "PRICE_CHANGED"
  | "PRICE_UNAVAILABLE"
  | "STOCK_UNAVAILABLE"
  | "VALIDATION_UNAVAILABLE"
  | "CREATE_OUTCOME_UNKNOWN"
  | "ORDER_REJECTED";

type PancakeOrderValidationRejectionReason = Extract<
  PancakeOrderSubmissionReason,
  | "LOCAL_ORDER_INVALID"
  | "SHOP_SCOPE_UNVERIFIED"
  | "VARIATION_UNAVAILABLE"
  | "PRICE_CHANGED"
  | "PRICE_UNAVAILABLE"
  | "STOCK_UNAVAILABLE"
>;

/**
 * Why a `STOCK_UNAVAILABLE` rejection happened, for operators only. The buyer always sees the one
 * buyer-facing reason; this tells an exhausted oversell allowance, a corrupt policy row and a plain
 * sell-out apart in the event stream (selling modes spec §7.1).
 */
export type PancakeOrderStockRejectionDetail =
  | "LIVE_STOCK_UNAVAILABLE"
  | "INSUFFICIENT_CAPACITY"
  | "NEGATIVE_LIMIT_REACHED"
  | "INVALID_POLICY"
  | "COMPOSITE_MODE_UNSUPPORTED"
  | "TOPOLOGY_UNPROVEN";

export type PancakeOrderSubmissionEvent =
  | {
      name: "pancake_order.validation_started";
      correlationId: string;
      state: "VALIDATING";
    }
  | {
      name: "pancake_order.validation_rejected";
      correlationId: string;
      state: "REJECTED";
      reason: PancakeOrderValidationRejectionReason;
      detail?: PancakeOrderStockRejectionDetail;
    }
  | {
      name: "pancake_order.validation_unavailable";
      correlationId: string;
      state: "DRAFT";
      reason: "VALIDATION_UNAVAILABLE";
    }
  | {
      name: "pancake_order.quote_repriced";
      correlationId: string;
      state: "DRAFT";
      reason: "PRICE_CHANGED";
    }
  | {
      name: "pancake_order.create_started";
      correlationId: string;
      state: "POS_SUBMITTING";
      dependency: "pancake";
      operation: "create_order";
    }
  | {
      name: "pancake_order.create_unknown";
      correlationId: string;
      state: "SYNC_UNKNOWN";
      reason: "CREATE_OUTCOME_UNKNOWN";
    }
  | {
      name: "pancake_order.confirmed";
      correlationId: string;
      state: "CONFIRMED";
    };

/**
 * The money a repriced DRAFT now carries.
 *
 * Returned so the buyer can be shown the new number and asked to confirm it. Display only: the next
 * submission recomputes the quote and re-checks the buyer's proof against that answer, exactly as
 * P9a requires, so nothing here is ever charged on the strength of having travelled through a
 * response body.
 */
export type PancakeOrderRepricedQuote = Readonly<{
  merchandiseSubtotalVnd: number;
  shippingFeeVnd: number;
  totalVnd: number;
}>;

export type PancakeOrderSubmissionResult =
  | { ok: true; state: "CONFIRMED"; pancakeOrderId: string }
  | {
      ok: false;
      state: "DRAFT";
      reason: "PRICE_CHANGED";
      repricedQuote: PancakeOrderRepricedQuote;
    }
  | {
      ok: false;
      state: "DRAFT" | "VALIDATING" | "POS_SUBMITTING" | "REJECTED" | "SYNC_UNKNOWN" | "CONFIRMED";
      reason: PancakeOrderSubmissionReason;
    };

export type PancakeOrderSubmissionGateway = {
  fetchCompleteCatalog(shopId: number): Promise<readonly PancakeCatalogVariation[]>;
  createOrder(request: PancakeCreateOrderRequest): Promise<unknown>;
};

export type PancakeOrderSubmissionOptions = {
  onEvent?: (event: PancakeOrderSubmissionEvent) => void;
  /**
   * The instant every campaign window is evaluated against for this submission.
   *
   * Injected rather than read inside the loop so one submission cannot straddle a campaign
   * boundary and price two lines of the same order against different instants.
   */
  now?: () => Date;
  /**
   * The deployment's selling-mode flags. Defaults to the environment. Both the live pre-check and
   * the locked reservation decide under these, through `effectivePolicy()`.
   */
  sellingModeFlags?: SellingModeFlags;
};

function emitSafely(
  observer: PancakeOrderSubmissionOptions["onEvent"],
  event: PancakeOrderSubmissionEvent,
): void {
  if (!observer) return;
  try {
    observer(event);
  } catch {
    // Observability must never change order submission semantics.
  }
}

function requirePublicCode(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PUBLIC_CODE_LENGTH ||
    value.trim() !== value
  ) {
    throw new TypeError("Order public code must be a normalized non-empty string");
  }
  return value;
}

function requireShopId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Pancake shop id must be a positive safe integer");
  }
  return value;
}

function isNormalizedNonEmptyString(value: string | null): value is string {
  return value !== null && value.length > 0 && value.trim() === value;
}

function isNormalizedOptionalString(value: string | null): boolean {
  return value === null || (value.length > 0 && value.trim() === value);
}

function isSupportedVndAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function checkedMultiplyVnd(unitPriceVnd: number, quantity: number): number | null {
  if (!isSupportedVndAmount(unitPriceVnd) || !Number.isSafeInteger(quantity) || quantity <= 0) {
    return null;
  }
  const result = unitPriceVnd * quantity;
  return isSupportedVndAmount(result) ? result : null;
}

function checkedAddVnd(left: number, right: number): number | null {
  const result = left + right;
  return isSupportedVndAmount(result) ? result : null;
}

/** Thrown inside the reservation transaction to roll it back when the submission claim was lost. */
class SubmissionClaimLost extends Error {}

/**
 * Budget for every submission transaction that locks or writes `VariantMirror` rows: the capacity
 * reservation, and the reprice/provenance refreshes that write fresher Pancake prices back.
 *
 * A catalog sync updates every mirrored variant inside one transaction of up to
 * `SYNC_TRANSACTION_TIMEOUT_MS`, so these must be able to wait it out. For the reservation the wait
 * is also a correctness property: the lock is what keeps a sync from committing a handoff between
 * its stock read and its hold read. Prisma's default of 5s would instead turn every checkout that
 * lands during a sync into a retryable failure, so the budget outlasts the longest sync with room to
 * finish the work.
 */
const MIRROR_WRITE_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: SYNC_TRANSACTION_TIMEOUT_MS + 15_000,
} as const;

function existingResult(order: {
  state: string;
  pancakeOrderId: string | null;
  syncErrorCode: string | null;
}): PancakeOrderSubmissionResult {
  if (order.state === "CONFIRMED" && order.pancakeOrderId) {
    return { ok: true, state: "CONFIRMED", pancakeOrderId: order.pancakeOrderId };
  }
  if (order.state === "SYNC_UNKNOWN") {
    return { ok: false, state: "SYNC_UNKNOWN", reason: "CREATE_OUTCOME_UNKNOWN" };
  }
  if (order.state === "REJECTED") {
    const reason = order.syncErrorCode;
    if (
      reason === "LOCAL_ORDER_INVALID" ||
      reason === "SHOP_SCOPE_UNVERIFIED" ||
      reason === "VARIATION_UNAVAILABLE" ||
      reason === "PRICE_CHANGED" ||
      reason === "PRICE_UNAVAILABLE" ||
      reason === "STOCK_UNAVAILABLE"
    ) {
      return { ok: false, state: "REJECTED", reason };
    }
    return { ok: false, state: "REJECTED", reason: "ORDER_REJECTED" };
  }
  if (order.state === "POS_SUBMITTING") {
    return { ok: false, state: "POS_SUBMITTING", reason: "SUBMISSION_ALREADY_CLAIMED" };
  }
  if (order.state === "VALIDATING") {
    return { ok: false, state: "VALIDATING", reason: "SUBMISSION_ALREADY_CLAIMED" };
  }
  if (order.state === "DRAFT") {
    return { ok: false, state: "DRAFT", reason: "SUBMISSION_BUSY" };
  }
  return { ok: false, state: "CONFIRMED", reason: "LOCAL_ORDER_INVALID" };
}

export function createPancakeOrderSubmissionService(
  client: PrismaClient,
  gateway: PancakeOrderSubmissionGateway,
  options: PancakeOrderSubmissionOptions = {},
) {
  const readNow = options.now ?? (() => new Date());
  const sellingModeFlags = options.sellingModeFlags ?? readSellingModeFlags();
  async function submit({
    publicCode,
    shopId,
  }: {
    publicCode: string;
    shopId: number;
  }): Promise<PancakeOrderSubmissionResult> {
    const safePublicCode = requirePublicCode(publicCode);
    const safeShopId = requireShopId(shopId);

    const claim = await client.orderMirror.updateMany({
      where: { publicCode: safePublicCode, state: "DRAFT" },
      data: { state: "VALIDATING", syncErrorCode: null },
    });

    if (claim.count !== 1) {
      const current = await client.orderMirror.findUnique({
        where: { publicCode: safePublicCode },
        select: { state: true, pancakeOrderId: true, syncErrorCode: true },
      });
      return current ? existingResult(current) : { ok: false, state: "DRAFT", reason: "ORDER_NOT_FOUND" };
    }

    const order = await client.orderMirror.findUniqueOrThrow({
      where: { publicCode: safePublicCode },
      include: { lines: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    const correlationId = order.id;
    emitSafely(options.onEvent, {
      name: "pancake_order.validation_started",
      correlationId,
      state: "VALIDATING",
    });

    async function reject(
      reason: PancakeOrderValidationRejectionReason,
      detail?: PancakeOrderStockRejectionDetail,
    ): Promise<PancakeOrderSubmissionResult> {
      await client.orderMirror.updateMany({
        where: { id: order.id, state: "VALIDATING" },
        data: { state: "REJECTED", syncErrorCode: reason },
      });
      emitSafely(options.onEvent, {
        name: "pancake_order.validation_rejected",
        correlationId,
        state: "REJECTED",
        reason,
        ...(detail === undefined ? {} : { detail }),
      });
      return { ok: false, state: "REJECTED", reason };
    }

    /**
     * The pricing provenance a finalized line must carry: what the base actually was, and which
     * campaign actually applied. Shared by both refresh paths so the reconfirmation write and the
     * provenance-only write cannot drift apart into two different notions of the audit.
     */
    function buildLineAudit(pricing: ReturnType<typeof resolvePromotionPricing>) {
      const promotion = pricing.promotion;
      return {
        baseUnitPriceVnd: pricing.basePriceVnd === null ? null : BigInt(pricing.basePriceVnd),
        promotionCampaignId: promotion?.id ?? null,
        promotionName: promotion?.name ?? null,
        promotionKind: promotion?.kind ?? null,
        promotionDiscountType: promotion?.discountType ?? null,
        promotionPercentageValue: promotion?.percentageValue ?? null,
        promotionFixedPriceVnd: promotion?.fixedPriceVnd ?? null,
      };
    }

    /**
     * Whether a finalized line would misreport how its price was reached.
     *
     * Deliberately separate from the money comparison. A fresher base behind a still-valid fixed
     * price, or one campaign handing over to another at the same final price, moves nothing the
     * buyer agreed to — so it must not trigger the reconfirmation handshake — but finalizing the
     * stale answer would write a base no upstream reported, or name a campaign that was already
     * over, into a snapshot the spec says is immutable and trustworthy.
     */
    function provenanceDiffers(
      line: (typeof order.lines)[number],
      audit: ReturnType<typeof buildLineAudit>,
    ): boolean {
      return (
        line.baseUnitPriceVnd !== audit.baseUnitPriceVnd ||
        line.promotionCampaignId !== audit.promotionCampaignId ||
        line.promotionName !== audit.promotionName ||
        line.promotionKind !== audit.promotionKind ||
        line.promotionDiscountType !== audit.promotionDiscountType ||
        line.promotionPercentageValue !== audit.promotionPercentageValue ||
        line.promotionFixedPriceVnd !== audit.promotionFixedPriceVnd
      );
    }

    /**
     * Hands a drifted order back to the buyer instead of killing it.
     *
     * `reject` is terminal: it is for orders that must not be placed at all. A price that moved
     * upstream is not that — the buyer simply has not agreed to the new number yet, and the correct
     * outcome is the same two-stage handshake P9a introduced. So this returns the order to `DRAFT`
     * carrying the refreshed quote, and the buyer must confirm it explicitly.
     *
     * The write is one transaction: line, audit and totals move together, because a half-refreshed
     * order is one whose stored totals disagree with its own lines. The guard on `VALIDATING`
     * ensures a submission that lost its claim cannot overwrite whatever took it.
     *
     * The fresher base is also written back to the mirror. Without that, the buyer's reconfirmation
     * re-derives the quote from stale mirrored data, submission finds the fresher base again, and the
     * handshake never terminates — the stale-mirror loop the spec names. Only the two price columns
     * are touched: `syncedAt` means "last reconciled by a catalog sync", which this is not.
     */
    async function repriceDraft(
      refreshed: ReadonlyArray<{
        id: string;
        variantId: string;
        quantity: number;
        freshBaseVnd: number;
        freshAfterDiscountVnd: number;
        pricing: ReturnType<typeof resolvePromotionPricing>;
      }>,
    ): Promise<PancakeOrderSubmissionResult> {
      let refreshedSubtotalVnd = 0;
      let refreshedQuantity = 0;
      const lineWrites: Array<{
        id: string;
        unitPriceVnd: bigint;
        lineTotalVnd: bigint;
        baseUnitPriceVnd: bigint | null;
        promotionCampaignId: string | null;
        promotionName: string | null;
        promotionKind: "PROMOTION" | "FLASH_SALE" | null;
        promotionDiscountType: "PERCENTAGE" | "FIXED_PRICE" | null;
        promotionPercentageValue: number | null;
        promotionFixedPriceVnd: bigint | null;
      }> = [];

      for (const line of refreshed) {
        const unitPriceVnd = line.pricing.effectivePriceVnd;
        const basePriceVnd = line.pricing.basePriceVnd;
        if (unitPriceVnd === null || basePriceVnd === null) return reject("PRICE_UNAVAILABLE");

        const lineTotalVnd = checkedMultiplyVnd(unitPriceVnd, line.quantity);
        const nextSubtotal =
          lineTotalVnd === null ? null : checkedAddVnd(refreshedSubtotalVnd, lineTotalVnd);
        const nextQuantity = refreshedQuantity + line.quantity;
        if (
          lineTotalVnd === null ||
          nextSubtotal === null ||
          !Number.isSafeInteger(nextQuantity) ||
          nextQuantity <= 0
        ) {
          return reject("LOCAL_ORDER_INVALID");
        }
        refreshedSubtotalVnd = nextSubtotal;
        refreshedQuantity = nextQuantity;

        if (line.pricing.isDiscounted && line.pricing.promotion === null) {
          return reject("LOCAL_ORDER_INVALID");
        }

        lineWrites.push({
          id: line.id,
          unitPriceVnd: BigInt(unitPriceVnd),
          lineTotalVnd: BigInt(lineTotalVnd),
          ...buildLineAudit(line.pricing),
        });
      }

      const refreshedShippingVnd = calculateGuestShippingFeeVnd({
        subtotalVnd: refreshedSubtotalVnd,
        totalQuantity: refreshedQuantity,
      });
      const refreshedTotalVnd = checkedAddVnd(refreshedSubtotalVnd, refreshedShippingVnd);
      if (refreshedTotalVnd === null) return reject("LOCAL_ORDER_INVALID");

      const claimed = await client.$transaction(async (tx) => {
        const held = await tx.orderMirror.updateMany({
          where: { id: order.id, state: "VALIDATING" },
          data: {
            state: "DRAFT",
            syncErrorCode: "PRICE_CHANGED",
            merchandiseSubtotalVnd: BigInt(refreshedSubtotalVnd),
            shippingFeeVnd: BigInt(refreshedShippingVnd),
            totalVnd: BigInt(refreshedTotalVnd),
          },
        });
        if (held.count !== 1) return false;

        // `updateMany` rather than `update` throughout: a row that vanished under a concurrent
        // catalog sync should leave the rest of the refresh intact, not abort the transaction and
        // surface to the buyer as an outage.
        for (const write of lineWrites) {
          const { id, ...data } = write;
          await tx.orderLineSnapshot.updateMany({ where: { id }, data });
        }
        for (const line of refreshed) {
          await tx.variantMirror.updateMany({
            where: { id: line.variantId },
            // Both columns carry what Pancake actually reported. Copying the base into the
            // after-discount field would invent an observation: the central resolver ignores that
            // field, but the Merchant identity audit and the default equality-gated price rule both
            // read it, and they would be reading a value no upstream ever sent.
            data: {
              pancakeRetailPrice: line.freshBaseVnd,
              pancakeRetailPriceAfterDiscount: line.freshAfterDiscountVnd,
            },
          });
        }
        return true;
      }, MIRROR_WRITE_TRANSACTION_OPTIONS);

      if (!claimed) {
        return { ok: false, state: "VALIDATING", reason: "SUBMISSION_ALREADY_CLAIMED" };
      }

      emitSafely(options.onEvent, {
        name: "pancake_order.quote_repriced",
        correlationId,
        state: "DRAFT",
        reason: "PRICE_CHANGED",
      });
      return {
        ok: false,
        state: "DRAFT",
        reason: "PRICE_CHANGED",
        repricedQuote: {
          merchandiseSubtotalVnd: refreshedSubtotalVnd,
          shippingFeeVnd: refreshedShippingVnd,
          totalVnd: refreshedTotalVnd,
        },
      };
    }

    /**
     * Corrects the finalized line's pricing provenance without asking the buyer anything.
     *
     * The counterpart to `repriceDraft`: that one exists because the buyer's money moved, this one
     * because it did not. Money columns are deliberately untouched here — `unitPriceVnd`,
     * `lineTotalVnd` and the order totals are exactly what the buyer confirmed, and rewriting them
     * would turn an audit correction into a silent repricing.
     *
     * The mirror is refreshed for the same reason as in the reconfirmation path: this submission
     * observed a fresher trusted base, and dropping it would leave the mirror knowingly stale.
     *
     * The guarded `updateMany` both proves the claim is still held and locks the row for the rest of
     * the transaction, so a submission that lost its claim cannot rewrite whatever took it.
     */
    async function refreshLineProvenance(
      refreshed: ReadonlyArray<{
        id: string;
        variantId: string;
        freshBaseVnd: number;
        freshAfterDiscountVnd: number;
        pricing: ReturnType<typeof resolvePromotionPricing>;
      }>,
    ): Promise<boolean> {
      return client.$transaction(async (tx) => {
        const held = await tx.orderMirror.updateMany({
          where: { id: order.id, state: "VALIDATING" },
          data: { syncErrorCode: null },
        });
        if (held.count !== 1) return false;

        for (const line of refreshed) {
          await tx.orderLineSnapshot.updateMany({
            where: { id: line.id },
            data: buildLineAudit(line.pricing),
          });
          await tx.variantMirror.updateMany({
            where: { id: line.variantId },
            data: {
              pancakeRetailPrice: line.freshBaseVnd,
              pancakeRetailPriceAfterDiscount: line.freshAfterDiscountVnd,
            },
          });
        }
        return true;
      }, MIRROR_WRITE_TRANSACTION_OPTIONS);
    }

    async function resetValidation(): Promise<PancakeOrderSubmissionResult> {
      await client.orderMirror.updateMany({
        where: { id: order.id, state: "VALIDATING" },
        data: { state: "DRAFT", syncErrorCode: "VALIDATION_UNAVAILABLE" },
      });
      emitSafely(options.onEvent, {
        name: "pancake_order.validation_unavailable",
        correlationId,
        state: "DRAFT",
        reason: "VALIDATION_UNAVAILABLE",
      });
      return { ok: false, state: "DRAFT", reason: "VALIDATION_UNAVAILABLE" };
    }

    if (order.pancakeShopId === null || order.pancakeShopId !== safeShopId) {
      return reject("SHOP_SCOPE_UNVERIFIED");
    }
    // A08 is not connected yet: the legacy submit path assumes one positive-price row per
    // variation. Never reinterpret laq2 PAID/GIFT rows as a legacy order or send an
    // unproven vendor representation. Nothing was posted, so this is retryable:
    // leave the DRAFT intact for the dedicated benefit submit path once installed.
    if (
      order.quoteVersion !== null ||
      order.lines.some((line) =>
        line.lineId !== null ||
        line.lineRole !== null ||
        line.benefitCampaignId !== null ||
        line.entitlementKey !== null
      )
    ) {
      return resetValidation();
    }
    const persistedShopId = order.pancakeShopId;

    if (
      order.checkoutSnapshottedAt === null ||
      !isNormalizedNonEmptyString(order.guestName) ||
      !isNormalizedNonEmptyString(order.guestPhone) ||
      !isNormalizedNonEmptyString(order.provinceRef) ||
      !isNormalizedNonEmptyString(order.districtRef) ||
      !isNormalizedNonEmptyString(order.communeRef) ||
      !isNormalizedNonEmptyString(order.addressDetail) ||
      !isNormalizedOptionalString(order.note) ||
      order.merchandiseSubtotalVnd === null ||
      order.shippingFeeVnd === null ||
      order.totalVnd === null ||
      order.lines.length === 0 ||
      order.lines.length > ANONYMOUS_CART_MAX_DISTINCT_ITEMS
    ) {
      return reject("LOCAL_ORDER_INVALID");
    }

    let liveCatalog: readonly PancakeCatalogVariation[];
    try {
      liveCatalog = await gateway.fetchCompleteCatalog(persistedShopId);
    } catch {
      return resetValidation();
    }

    const liveByVariationId = new Map<string, PancakeCatalogVariation | null>();
    for (const variation of liveCatalog) {
      if (liveByVariationId.has(variation.id)) {
        liveByVariationId.set(variation.id, null);
      } else {
        liveByVariationId.set(variation.id, variation);
      }
    }

    // The fresher base is only half the answer. A website sale is `resolvePromotionPricing(base,
    // campaigns)`, so comparing a promoted DRAFT against raw Pancake retail would refuse every
    // correctly discounted order; and a percentage campaign against a moved base yields a different
    // number that the buyer has not agreed to. Both sides of the comparison therefore go through the
    // one resolver, at one instant.
    const now = readNow();
    // Inside the same pre-write recovery boundary as the catalog read above, and for the same
    // reason: the claim has moved the row to `VALIDATING`, but nothing has been sent to Pancake yet.
    // A transient failure resolving promotion candidates is therefore retryable, not fatal. Letting
    // it escape would leave the row `VALIDATING`, which the recovery sweep converts to a terminal
    // `REJECTED / VALIDATION_INTERRUPTED` fifteen minutes later — killing an order that only needed
    // to be tried again.
    let campaignsByVariantId: ApplicableCampaignLookup["campaignsByVariantId"];
    try {
      ({ campaignsByVariantId } = await readApplicablePromotionCampaignsBatched({
        variantIds: order.lines.map(({ variantId }) => variantId),
        client: client as unknown as PromotionCandidateReadClient,
      }));
    } catch {
      return resetValidation();
    }

    // The concrete stock each line spends, so the live check below looks at what a sale actually
    // consumes: a composite parent's own Pancake figure is not the stock a set sale spends (spec §5.1).
    // A pre-write read like the ones above, so a transient failure is retryable, not fatal.
    let componentEdges: Array<{
      parentVariantId: string;
      quantity: number;
      componentVariant: { pancakeVariationId: string };
    }>;
    try {
      componentEdges = await client.compositeComponentMirror.findMany({
        where: { parentVariantId: { in: order.lines.map(({ variantId }) => variantId) } },
        orderBy: [{ parentVariantId: "asc" }, { componentVariantId: "asc" }],
        select: {
          parentVariantId: true,
          quantity: true,
          componentVariant: { select: { pancakeVariationId: true } },
        },
      });
    } catch {
      return resetValidation();
    }
    const componentsByParent = new Map<string, typeof componentEdges>();
    for (const edge of componentEdges) {
      const list = componentsByParent.get(edge.parentVariantId) ?? [];
      list.push(edge);
      componentsByParent.set(edge.parentVariantId, list);
    }
    // The selling policy of every purchased variant, for the live pre-check's floors. Read without the
    // `VariantMirror` locks, so it may already be stale when the locked reservation decides (selling
    // modes spec §7.3): a looser answer here is caught by that decision; a stricter one rejects this
    // order, and the buyer's next checkout from the same cart reads the new policy.
    let linePolicies: Map<string, EffectiveSellingPolicy>;
    try {
      linePolicies = await readEffectiveSellingPolicies(
        client,
        order.lines.map(({ variantId }) => variantId),
        sellingModeFlags,
      );
    } catch {
      return resetValidation();
    }
    let policyRefusal: "INVALID_POLICY" | "COMPOSITE_MODE_UNSUPPORTED" | null = null;
    const liveDemandByVariationId = new Map<string, number>();
    const liveFloorByVariationId = new Map<string, number>();

    const requestedVariationIds = new Set<string>();
    const requestLines: Array<{
      pancakeVariationId: string;
      quantity: number;
      unitPriceVnd: number;
    }> = [];
    const freshLines: Array<{
      id: string;
      variantId: string;
      quantity: number;
      freshBaseVnd: number;
      freshAfterDiscountVnd: number;
      pricing: ReturnType<typeof resolvePromotionPricing>;
    }> = [];
    let drifted = false;
    let provenanceDrifted = false;
    let subtotalVnd = 0;
    let totalQuantity = 0;

    for (const line of order.lines) {
      if (
        !isNormalizedNonEmptyString(line.pancakeVariationId) ||
        requestedVariationIds.has(line.pancakeVariationId) ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity <= 0
      ) {
        return reject("LOCAL_ORDER_INVALID");
      }
      requestedVariationIds.add(line.pancakeVariationId);

      const live = liveByVariationId.get(line.pancakeVariationId);
      if (!live) {
        return reject("VARIATION_UNAVAILABLE");
      }

      // Deliberately `retailPrice` alone, matching the central authority: a lower Pancake
      // after-discount field is an order-level rule there, not a catalog price, so it neither sets
      // nor invalidates the website price.
      if (!isUsableBasePriceVnd(live.retailPrice)) {
        return reject("PRICE_UNAVAILABLE");
      }
      const freshPricing = resolvePromotionPricing({
        basePriceVnd: live.retailPrice,
        campaigns: campaignsByVariantId.get(line.variantId) ?? [],
        now,
      });
      const freshUnitPriceVnd = freshPricing.effectivePriceVnd;
      if (freshUnitPriceVnd === null || !isSupportedVndAmount(freshUnitPriceVnd)) {
        return reject("PRICE_UNAVAILABLE");
      }
      const components = componentsByParent.get(line.variantId) ?? [];
      const consumed =
        components.length === 0
          ? [{ pancakeVariationId: line.pancakeVariationId, quantity: line.quantity }]
          : components.map((edge) => ({
              pancakeVariationId: edge.componentVariant.pancakeVariationId,
              quantity: edge.quantity * line.quantity,
            }));
      // Same floors as the locked decision (spec §5, §6): the purchased variant's own floor for a
      // standalone line, 0 for every component of a set, and the stricter one where both meet.
      const policy = linePolicies.get(line.variantId);
      if (!policy || policy.kind === "REFUSE") {
        policyRefusal ??= "INVALID_POLICY";
      } else if (components.length > 0 && policy.mode !== "STANDARD") {
        policyRefusal ??= "COMPOSITE_MODE_UNSUPPORTED";
      }
      const resourceFloor = components.length === 0 && policy?.kind === "SELL" ? policy.floor : 0;
      for (const resource of consumed) {
        const demand = (liveDemandByVariationId.get(resource.pancakeVariationId) ?? 0) + resource.quantity;
        if (!Number.isSafeInteger(resource.quantity) || resource.quantity <= 0 || !Number.isSafeInteger(demand)) {
          return reject("LOCAL_ORDER_INVALID");
        }
        liveDemandByVariationId.set(resource.pancakeVariationId, demand);
        const floor = liveFloorByVariationId.get(resource.pancakeVariationId);
        liveFloorByVariationId.set(
          resource.pancakeVariationId,
          floor === undefined ? resourceFloor : Math.max(floor, resourceFloor),
        );
      }
      if (line.unitPriceVnd !== BigInt(freshUnitPriceVnd)) {
        drifted = true;
      } else if (provenanceDiffers(line, buildLineAudit(freshPricing))) {
        // Same money, different story about how it was reached. Not a buyer-facing change, so it
        // must not trigger the handshake — but it is still wrong to finalize.
        provenanceDrifted = true;
      }
      freshLines.push({
        id: line.id,
        variantId: line.variantId,
        quantity: line.quantity,
        freshBaseVnd: live.retailPrice,
        freshAfterDiscountVnd: live.retailPriceAfterDiscount,
        pricing: freshPricing,
      });

      const lineTotalVnd = checkedMultiplyVnd(Number(line.unitPriceVnd), line.quantity);
      const nextSubtotal = lineTotalVnd === null ? null : checkedAddVnd(subtotalVnd, lineTotalVnd);
      const nextQuantity = totalQuantity + line.quantity;
      if (
        lineTotalVnd === null ||
        nextSubtotal === null ||
        !Number.isSafeInteger(nextQuantity) ||
        nextQuantity <= 0 ||
        line.lineTotalVnd !== BigInt(lineTotalVnd)
      ) {
        return reject("LOCAL_ORDER_INVALID");
      }

      subtotalVnd = nextSubtotal;
      totalQuantity = nextQuantity;
      requestLines.push({
        pancakeVariationId: line.pancakeVariationId,
        quantity: line.quantity,
        // The money the buyer confirmed, which the drift check above has just established equals the
        // fresh effective quote. Sending the live base here instead would charge full price for a
        // line the website sold at a discount.
        unitPriceVnd: Number(line.unitPriceVnd),
      });
    }

    if (policyRefusal !== null) return reject("STOCK_UNAVAILABLE", policyRefusal);

    // Live Pancake stock for every resource the order spends, summed across lines that share one,
    // measured against the same floor as the locked decision. Advisory to the local reservation
    // below, which is the authority; this only refuses early when Pancake itself already reports too
    // little.
    for (const [pancakeVariationId, demand] of liveDemandByVariationId) {
      const live = liveByVariationId.get(pancakeVariationId);
      const floor = liveFloorByVariationId.get(pancakeVariationId) ?? 0;
      if (!live || !Number.isFinite(live.sellableStock) || live.sellableStock - demand < floor) {
        return reject("STOCK_UNAVAILABLE", "LIVE_STOCK_UNAVAILABLE");
      }
    }

    // Before any totals assertion or outbound call: a drifted quote is not an invalid order, and
    // must not be judged against totals the buyer is about to be asked to replace.
    if (drifted) {
      return repriceDraft(freshLines);
    }

    const shippingFeeVnd = calculateGuestShippingFeeVnd({ subtotalVnd, totalQuantity });
    const totalVnd = checkedAddVnd(subtotalVnd, shippingFeeVnd);
    if (
      totalVnd === null ||
      order.merchandiseSubtotalVnd !== BigInt(subtotalVnd) ||
      order.shippingFeeVnd !== BigInt(shippingFeeVnd) ||
      order.totalVnd !== BigInt(totalVnd)
    ) {
      return reject("LOCAL_ORDER_INVALID");
    }

    // Money is settled and asserted; only the story behind it is stale. Corrected here, before the
    // outbound claim, so the finalized line is already truthful when it becomes immutable. Inside
    // the same pre-write recovery boundary as the reads above: nothing has been sent to Pancake yet,
    // so a transient failure is retryable rather than a stranded claim.
    if (provenanceDrifted) {
      let refreshed: boolean;
      try {
        refreshed = await refreshLineProvenance(freshLines);
      } catch {
        return resetValidation();
      }
      if (!refreshed) {
        const current = await client.orderMirror.findUniqueOrThrow({
          where: { id: order.id },
          select: { state: true, pancakeOrderId: true, syncErrorCode: true },
        });
        return existingResult(current);
      }
    }

    const request = buildPancakeCreateOrderRequest({
      shopId: persistedShopId,
      guestName: order.guestName,
      guestPhone: order.guestPhone,
      provinceRef: order.provinceRef,
      districtRef: order.districtRef,
      communeRef: order.communeRef,
      addressDetail: order.addressDetail,
      note: order.note,
      shippingFeeVnd,
      lines: requestLines,
    });

    // The capacity hold and the `POS_SUBMITTING` claim commit together or not at all, so no request
    // can leave without a hold and no hold exists for an order that never reached the external call
    // (spec §5.4.1). Nothing has been sent yet, so any failure here is still retryable.
    let reservation: Awaited<ReturnType<typeof reserveOrderCapacity>>;
    try {
      reservation = await client.$transaction(async (tx) => {
        const reserved = await reserveOrderCapacity(tx, {
          orderId: order.id,
          lines: order.lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
          sellingModeFlags,
        });
        if (!reserved.ok) return reserved;
        const submitting = await tx.orderMirror.updateMany({
          where: { id: order.id, state: "VALIDATING" },
          data: { state: "POS_SUBMITTING", syncErrorCode: null },
        });
        if (submitting.count !== 1) throw new SubmissionClaimLost();
        return reserved;
      }, MIRROR_WRITE_TRANSACTION_OPTIONS);
    } catch (error) {
      if (!(error instanceof SubmissionClaimLost)) return resetValidation();
      const current = await client.orderMirror.findUniqueOrThrow({
        where: { id: order.id },
        select: { state: true, pancakeOrderId: true, syncErrorCode: true },
      });
      return existingResult(current);
    }
    if (!reservation.ok) {
      if (reservation.reason === "TOPOLOGY_CHANGED") return resetValidation();
      if (reservation.reason === "VARIANT_MISSING") return reject("VARIATION_UNAVAILABLE");
      if (reservation.reason === "INVALID_ORDER") return reject("LOCAL_ORDER_INVALID");
      return reject("STOCK_UNAVAILABLE", reservation.reason);
    }

    emitSafely(options.onEvent, {
      name: "pancake_order.create_started",
      correlationId,
      state: "POS_SUBMITTING",
      dependency: "pancake",
      operation: "create_order",
    });

    let pancakeOrderId: string;
    try {
      const response = await gateway.createOrder(request);
      pancakeOrderId = parsePancakeCreateOrderResponse(response);
    } catch {
      await client.orderMirror.updateMany({
        where: { id: order.id, state: "POS_SUBMITTING" },
        data: { state: "SYNC_UNKNOWN", syncErrorCode: "CREATE_OUTCOME_UNKNOWN" },
      });
      emitSafely(options.onEvent, {
        name: "pancake_order.create_unknown",
        correlationId,
        state: "SYNC_UNKNOWN",
        reason: "CREATE_OUTCOME_UNKNOWN",
      });
      return { ok: false, state: "SYNC_UNKNOWN", reason: "CREATE_OUTCOME_UNKNOWN" };
    }

    // Sampled once the response is in hand: the exact order is known to exist no later than now, so a
    // stock observation that starts after this instant cannot have missed it.
    const acceptedAt = new Date();
    try {
      const confirmed = await client.$transaction(async (tx) => {
        const moved = await tx.orderMirror.updateMany({
          where: { id: order.id, state: "POS_SUBMITTING" },
          data: {
            state: "CONFIRMED",
            pancakeOrderId,
            syncErrorCode: null,
          },
        });
        if (moved.count === 1) await markOrderCapacityAccepted(tx, order.id, acceptedAt);
        return moved;
      });
      if (confirmed.count !== 1) {
        const current = await client.orderMirror.findUniqueOrThrow({
          where: { id: order.id },
          select: { state: true, pancakeOrderId: true, syncErrorCode: true },
        });
        return existingResult(current);
      }
    } catch {
      await client.orderMirror.updateMany({
        where: { id: order.id, state: "POS_SUBMITTING" },
        data: { state: "SYNC_UNKNOWN", syncErrorCode: "CREATE_OUTCOME_UNKNOWN" },
      });
      emitSafely(options.onEvent, {
        name: "pancake_order.create_unknown",
        correlationId,
        state: "SYNC_UNKNOWN",
        reason: "CREATE_OUTCOME_UNKNOWN",
      });
      return { ok: false, state: "SYNC_UNKNOWN", reason: "CREATE_OUTCOME_UNKNOWN" };
    }

    emitSafely(options.onEvent, {
      name: "pancake_order.confirmed",
      correlationId,
      state: "CONFIRMED",
    });
    return { ok: true, state: "CONFIRMED", pancakeOrderId };
  }

  return { submit };
}
