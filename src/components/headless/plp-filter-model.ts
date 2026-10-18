/**
 * The interaction rules of a product-listing filter region, as pure functions.
 *
 * What a filter *means* is not decided here. The URL, the parsing, the sort, the page reset and every
 * href already belong to `storefront-discovery.ts` and `routes/shop-model.ts`; a brand draws the
 * `ListingOption` links and GET form those produce. This file owns only the part a plain form cannot
 * do on a phone: whether the filter panel is collapsed behind a button, where keyboard focus goes
 * when it opens, closes or the listing re-renders, and what a screen reader is told afterwards. None
 * of it touches a price, a sort or a URL, and none of it carries copy: a brand supplies the words.
 *
 * The panel is progressive enhancement. Until the client reports a viewport (`ready` is false) the
 * panel is visible and the trigger is hidden, so a shopper without JavaScript has the whole form and
 * no button that does nothing.
 */

export type PlpFilterFocusIntent = "trigger" | "panel" | null;

export type PlpFilterDisclosureState = Readonly<{
  /** False until the client has measured the viewport; nothing is collapsed before then. */
  ready: boolean;
  /** At or above the brand's breakpoint the panel is simply part of the page, never collapsed. */
  wide: boolean;
  open: boolean;
  /** Where focus should move once the DOM reflects this state; the consumer clears it. */
  focus: PlpFilterFocusIntent;
}>;

export type PlpFilterDisclosureEvent =
  | Readonly<{ type: "VIEWPORT"; wide: boolean }>
  | Readonly<{ type: "TOGGLE" }>
  | Readonly<{ type: "ESCAPE" }>
  /** The listing re-rendered for a different filter state. */
  | Readonly<{ type: "NAVIGATED" }>
  | Readonly<{ type: "FOCUS_HANDLED" }>;

export const INITIAL_PLP_FILTER_DISCLOSURE: PlpFilterDisclosureState = Object.freeze({
  ready: false,
  wide: true,
  open: false,
  focus: null,
});

function next(
  state: PlpFilterDisclosureState,
  patch: Partial<PlpFilterDisclosureState>,
): PlpFilterDisclosureState {
  return Object.freeze({ ...state, ...patch });
}

export function reducePlpFilterDisclosure(
  state: PlpFilterDisclosureState,
  event: PlpFilterDisclosureEvent,
): PlpFilterDisclosureState {
  switch (event.type) {
    case "VIEWPORT":
      // Measuring never moves focus: it can fire on a rotation while the shopper is typing.
      if (state.ready && state.wide === event.wide) return state;
      return next(state, { ready: true, wide: event.wide, open: false, focus: null });

    case "TOGGLE":
      // Unmeasured or wide, there is no trigger to toggle.
      if (!state.ready || state.wide) return state;
      return state.open
        ? next(state, { open: false, focus: "trigger" })
        : next(state, { open: true, focus: "panel" });

    case "ESCAPE":
      if (!state.ready || state.wide || !state.open) return state;
      return next(state, { open: false, focus: "trigger" });

    case "NAVIGATED":
      // Applying a filter ends the task the panel was open for; the shopper lands on the trigger,
      // which now also states how many filters are active.
      if (!state.ready || state.wide || !state.open) return state;
      return next(state, { open: false, focus: "trigger" });

    case "FOCUS_HANDLED":
      return state.focus === null ? state : next(state, { focus: null });
  }
}

/** Whether the filter controls are on screen (and in the tab order). */
export function isPlpFilterPanelVisible(state: PlpFilterDisclosureState): boolean {
  return !state.ready || state.wide || state.open;
}

/** Whether the collapse button exists at all. */
export function isPlpFilterTriggerVisible(state: PlpFilterDisclosureState): boolean {
  return state.ready && !state.wide;
}

export type PlpFilterSummary = Readonly<{
  /** One per applied filter; sort is a view of the results, not a filter, and is never counted. */
  activeCount: number;
  hasActive: boolean;
}>;

export function buildPlpFilterSummary(
  activeFilters: readonly Readonly<{ value: string | null }>[],
): PlpFilterSummary {
  const keys = new Set<string>();
  for (const filter of activeFilters) {
    if (filter.value !== null) keys.add(filter.value);
  }
  return Object.freeze({ activeCount: keys.size, hasActive: keys.size > 0 });
}

/**
 * Where focus goes after the shopper removes a chip.
 *
 * The removed chip is about to unmount, which would drop focus onto the page body. The next chip
 * takes it, else the previous one; with none left the consumer falls back to the filter trigger.
 * `null` also covers a key that is not in the list, so a stale click never invents a target.
 */
export function resolvePlpChipRemovalFocus(
  chipKeys: readonly string[],
  removedKey: string,
): string | null {
  const index = chipKeys.indexOf(removedKey);
  if (index === -1) return null;
  const following = chipKeys[index + 1];
  if (following !== undefined) return following;
  const preceding = chipKeys[index - 1];
  return preceding ?? null;
}

export type PlpResultAnnouncement =
  | Readonly<{ kind: "results"; count: number }>
  | Readonly<{ kind: "empty" }>;

/** The count a polite live region should state once the listing has re-rendered. */
export function buildPlpResultAnnouncement(totalCount: number): PlpResultAnnouncement {
  if (!Number.isSafeInteger(totalCount) || totalCount <= 0) return Object.freeze({ kind: "empty" });
  return Object.freeze({ kind: "results", count: totalCount });
}
