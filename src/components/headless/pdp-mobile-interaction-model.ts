/**
 * The mobile product-page interactions the Core Kit did not have, as pure functions: stepping and
 * swiping a gallery, and the state of a sticky purchase bar.
 *
 * What is *true* about a purchase is not decided here. Price text, purchasability, the unavailable
 * reason and the preorder marker already come from `variant-selection-model.ts`; which photo a
 * colour maps to comes from `resolve-gallery-model.ts`. This file only reads those facts and
 * decides how a gesture, a key or a scroll position moves the frame or the bar. It carries no copy
 * and no layout, so a brand keeps its own photo ratio, typography and panel composition.
 */

/* -------------------------------------------------------------------- gallery */

export type GalleryDirection = "previous" | "next";

export type GalleryStep = Readonly<{
  index: number;
  /** False when the step was refused at an end of the gallery. */
  changed: boolean;
}>;

/**
 * One step along the gallery. It does not wrap: a swipe past the last photo does nothing, so a
 * shopper is never thrown from the end back to the start, and a boundary button can say it is
 * disabled instead of silently looping.
 */
export function resolveGalleryStep(input: {
  activeIndex: number;
  imageCount: number;
  direction: GalleryDirection;
}): GalleryStep {
  const { activeIndex, imageCount, direction } = input;
  if (!Number.isSafeInteger(imageCount) || imageCount < 2) return Object.freeze({ index: 0, changed: false });
  const current = Number.isSafeInteger(activeIndex) ? Math.min(Math.max(activeIndex, 0), imageCount - 1) : 0;
  const target = direction === "next" ? current + 1 : current - 1;
  if (target < 0 || target > imageCount - 1) return Object.freeze({ index: current, changed: false });
  return Object.freeze({ index: target, changed: true });
}

export type GalleryNavigationState = Readonly<{
  canPrevious: boolean;
  canNext: boolean;
  /** 1-based, for "photo 2 of 5". `0` when there is no gallery. */
  position: number;
  count: number;
}>;

export function resolveGalleryNavigation(activeIndex: number, imageCount: number): GalleryNavigationState {
  if (!Number.isSafeInteger(imageCount) || imageCount < 1) {
    return Object.freeze({ canPrevious: false, canNext: false, position: 0, count: 0 });
  }
  const current = Number.isSafeInteger(activeIndex) ? Math.min(Math.max(activeIndex, 0), imageCount - 1) : 0;
  return Object.freeze({
    canPrevious: current > 0,
    canNext: current < imageCount - 1,
    position: current + 1,
    count: imageCount,
  });
}

/** The image a key selects while the gallery has focus, or `null` for a key it does not own. */
export function resolveGalleryKey(
  key: string,
  input: { activeIndex: number; imageCount: number },
): number | null {
  if (input.imageCount < 2) return null;
  switch (key) {
    case "ArrowLeft":
      return resolveGalleryStep({ ...input, direction: "previous" }).index;
    case "ArrowRight":
      return resolveGalleryStep({ ...input, direction: "next" }).index;
    case "Home":
      return 0;
    case "End":
      return input.imageCount - 1;
    default:
      return null;
  }
}

export type SwipeGesture = Readonly<{
  /** Pointer travel from touch start to touch end, in CSS pixels. Negative `dx` is a swipe left. */
  dx: number;
  dy: number;
  durationMs: number;
}>;

export type SwipeThresholds = Readonly<{
  minDistancePx: number;
  /** How much more horizontal than vertical the travel must be; below it the shopper is scrolling. */
  dominanceRatio: number;
  maxDurationMs: number;
}>;

export const DEFAULT_SWIPE_THRESHOLDS: SwipeThresholds = Object.freeze({
  minDistancePx: 48,
  dominanceRatio: 1.5,
  maxDurationMs: 800,
});

/**
 * Whether a finished touch is a swipe, and which way the gallery moves.
 *
 * A swipe left reveals the next photo. A mostly-vertical, short or slow drag is a page scroll or a
 * hesitation and returns `null`, so reading the page never flips the photograph.
 */
export function resolveSwipeDirection(
  gesture: SwipeGesture,
  thresholds: SwipeThresholds = DEFAULT_SWIPE_THRESHOLDS,
): GalleryDirection | null {
  const { dx, dy, durationMs } = gesture;
  if (![dx, dy, durationMs].every(Number.isFinite)) return null;
  if (durationMs < 0 || durationMs > thresholds.maxDurationMs) return null;
  const horizontal = Math.abs(dx);
  if (horizontal < thresholds.minDistancePx) return null;
  if (horizontal < Math.abs(dy) * thresholds.dominanceRatio) return null;
  return dx < 0 ? "next" : "previous";
}

/* ------------------------------------------------------------- purchase state */

export type PurchaseOptionKey = "kind" | "size" | "color";

export type PurchaseCtaKind =
  /** The product has no purchasable option at all; there is nothing to ask the shopper to choose. */
  | "none"
  /** An add is in flight. */
  | "pending"
  /** A complete choice is needed first; `missing` names what, in the panel's own order. */
  | "choose"
  /** A complete choice that cannot be bought now. */
  | "unavailable"
  /** A complete choice that sells as a preorder. */
  | "preorder"
  | "ready";

export type PurchaseCtaState = Readonly<{
  kind: PurchaseCtaKind;
  missing: readonly PurchaseOptionKey[];
  /** Whether activating the primary action would add to the bag. */
  canAdd: boolean;
  /** `OUT_OF_STOCK` or another reason the selected option cannot be bought; `null` otherwise. */
  unavailableReason: string | null;
}>;

/** The slice of `resolveVariantSelectionView` this decision reads. */
export type PurchaseCtaView = Readonly<{
  hasKindOptions: boolean;
  hasColorOptions: boolean;
  hasPurchasableVariant: boolean;
  selectedVariantId: string | null;
  canAdd: boolean;
  selectedUnavailableReason: string | null;
  preorderMessage: string;
}>;

export function resolvePurchaseCtaState(input: {
  view: PurchaseCtaView;
  selection: Readonly<{ kindKey: string | null; color: string | null; size: string | null }>;
  isPending: boolean;
}): PurchaseCtaState {
  const { view, selection, isPending } = input;
  const state = (
    kind: PurchaseCtaKind,
    extra: Partial<Pick<PurchaseCtaState, "missing" | "canAdd" | "unavailableReason">> = {},
  ): PurchaseCtaState =>
    Object.freeze({ kind, missing: Object.freeze([]), canAdd: false, unavailableReason: null, ...extra });

  if (!view.hasPurchasableVariant) return state("none");
  if (isPending) return state("pending");

  if (view.selectedVariantId === null) {
    // The panel's own order, so "what is missing" reads top to bottom: a product with kinds asks
    // kind, size, colour; one without asks colour, size.
    const missing: PurchaseOptionKey[] = [];
    const needsKind = view.hasKindOptions && selection.kindKey === null;
    const needsColor = view.hasColorOptions && selection.color === null;
    const needsSize = selection.size === null;
    if (view.hasKindOptions) {
      if (needsKind) missing.push("kind");
      if (needsSize) missing.push("size");
      if (needsColor) missing.push("color");
    } else {
      if (needsColor) missing.push("color");
      if (needsSize) missing.push("size");
    }
    // A complete choice that resolves to no variant (a colour the size does not come in) still
    // needs the shopper to choose again; naming the colour is the least wrong prompt.
    if (missing.length === 0) missing.push(view.hasColorOptions ? "color" : "size");
    return state("choose", { missing: Object.freeze(missing) });
  }

  if (!view.canAdd) return state("unavailable", { unavailableReason: view.selectedUnavailableReason });
  return view.preorderMessage !== "" ? state("preorder", { canAdd: true }) : state("ready", { canAdd: true });
}

/**
 * Whether the sticky bar is on screen.
 *
 * It exists to keep the primary action reachable while the real one is out of view, so it shows
 * only on a narrow viewport and only once the panel itself is not intersecting. Until the client
 * has measured both, it is absent: a server-rendered page never carries a bar over its content.
 */
export function resolveStickyBarVisible(input: {
  ready: boolean;
  wide: boolean;
  panelIntersecting: boolean;
  ctaKind: PurchaseCtaKind;
}): boolean {
  if (!input.ready || input.wide || input.panelIntersecting) return false;
  // With nothing to buy there is no action to keep reachable.
  return input.ctaKind !== "none";
}
