import { STOREFRONT_SEARCH_SUGGESTION_LIMITS } from "../../commerce/storefront-search-suggestions.ts";
import type { SearchSuggestionsModel } from "../../routes/search-suggestions-model.ts";

/**
 * The state and keyboard rules of a search overlay, as pure functions.
 *
 * The overlay shows exactly what the bounded suggestion read model returned (B07), which is itself
 * the first rows of the canonical `/shop` listing for the same text. Nothing here knows a price, a
 * URL or a visibility rule. What is decided here is when the overlay is open, which response may
 * fill it, and where keyboard focus goes. The text input is a real search form that submits to
 * `/shop`, so the overlay is an enhancement over a page that already searches without it.
 *
 * Two rules matter most. A response is applied only if it answers the text currently in the box and
 * the latest request, so a slow answer for "ao" can never replace the answer for "ao so mi". And
 * every failure state is a message, never a stale list.
 */

export type SearchOverlayStatus =
  /** Nothing typed yet, or fewer characters than a suggestion needs. */
  | "short"
  | "loading"
  | "ready"
  | "empty"
  | "error";

export type SearchOverlayFocusIntent = "input" | "opener" | null;

export type SearchOverlayState = Readonly<{
  open: boolean;
  query: string;
  status: SearchOverlayStatus;
  /** The request this state is waiting on; a response for any other id is stale. */
  requestId: number;
  result: Extract<SearchSuggestionsModel, { ok: true }> | null;
  focus: SearchOverlayFocusIntent;
}>;

export type SearchOverlayEvent =
  | Readonly<{ type: "OPEN" }>
  | Readonly<{ type: "CLOSE" }>
  | Readonly<{ type: "INPUT"; text: string }>
  | Readonly<{ type: "REQUEST"; requestId: number }>
  | Readonly<{ type: "LOADED"; requestId: number; query: string; model: SearchSuggestionsModel }>
  | Readonly<{ type: "FAILED"; requestId: number; query: string }>
  | Readonly<{ type: "FOCUS_HANDLED" }>;

export const INITIAL_SEARCH_OVERLAY: SearchOverlayState = Object.freeze({
  open: false,
  query: "",
  status: "short",
  requestId: 0,
  result: null,
  focus: null,
});

/** Whether the text is long enough to be worth a request. The same minimum the server enforces. */
export function isSearchOverlayQueryReady(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length >= STOREFRONT_SEARCH_SUGGESTION_LIMITS.minQueryLength
    && text.length <= STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxQueryLength
  );
}

function settle(state: SearchOverlayState, model: SearchSuggestionsModel): SearchOverlayState {
  if (!model.ok) {
    // A too-short or oversized query is the shopper's to fix; every other failure is ours.
    const shopperFixable = model.reason === "QUERY_TOO_SHORT" || model.reason === "INVALID_QUERY";
    return Object.freeze({ ...state, status: shopperFixable ? "short" : "error", result: null });
  }
  return Object.freeze({
    ...state,
    status: model.items.length === 0 ? "empty" : "ready",
    result: model,
  });
}

export function reduceSearchOverlay(
  state: SearchOverlayState,
  event: SearchOverlayEvent,
): SearchOverlayState {
  switch (event.type) {
    case "OPEN":
      if (state.open) return state;
      return Object.freeze({ ...INITIAL_SEARCH_OVERLAY, open: true, focus: "input" });

    case "CLOSE":
      if (!state.open) return state;
      // Closing invalidates anything in flight: the request id moves on and the list is dropped.
      return Object.freeze({ ...INITIAL_SEARCH_OVERLAY, requestId: state.requestId + 1, focus: "opener" });

    case "INPUT":
      if (!state.open) return state;
      // New text means the previous answer is about different text: never keep showing it.
      return Object.freeze({
        ...state,
        query: event.text,
        status: isSearchOverlayQueryReady(event.text) ? "loading" : "short",
        result: null,
      });

    case "REQUEST":
      if (!state.open) return state;
      return Object.freeze({ ...state, requestId: event.requestId, status: "loading", result: null });

    case "LOADED":
      if (!state.open || event.requestId !== state.requestId || event.query !== state.query) return state;
      return settle(state, event.model);

    case "FAILED":
      if (!state.open || event.requestId !== state.requestId || event.query !== state.query) return state;
      return Object.freeze({ ...state, status: "error", result: null });

    case "FOCUS_HANDLED":
      return state.focus === null ? state : Object.freeze({ ...state, focus: null });
  }
}

/**
 * Where an arrow key moves focus among the suggestion links, as an index; `-1` is the input.
 * Returns `null` for a key the list does not own or a move that goes nowhere. ArrowDown from the
 * input enters the list, ArrowUp from the first suggestion returns to the input, and neither wraps.
 */
export function resolveSuggestionArrow(input: {
  key: string;
  activeIndex: number;
  count: number;
}): number | null {
  const { key, activeIndex, count } = input;
  if (count < 1) return null;
  if (key === "ArrowDown") {
    const next = Math.min(activeIndex + 1, count - 1);
    return next === activeIndex ? null : next;
  }
  if (key === "ArrowUp") {
    if (activeIndex < 0) return null;
    return activeIndex - 1;
  }
  return null;
}

export type SearchOverlayAnnouncement =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "results"; count: number; total: number }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "error" }>
  | null;

/** What a polite live region should say; `null` while the shopper has not typed enough to ask. */
export function buildSearchOverlayAnnouncement(state: SearchOverlayState): SearchOverlayAnnouncement {
  switch (state.status) {
    case "loading":
      return { kind: "loading" };
    case "ready":
      return state.result === null
        ? null
        : { kind: "results", count: state.result.items.length, total: state.result.totalCount };
    case "empty":
      return { kind: "empty" };
    case "error":
      return { kind: "error" };
    case "short":
      return null;
  }
}
