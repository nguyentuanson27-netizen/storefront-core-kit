"use client";

import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";

import { STOREFRONT_SEARCH_SUGGESTION_LIMITS } from "@/commerce/storefront-search-suggestions";
import { searchStorefrontSuggestions } from "@/routes/search-suggestions";

import { resolveFocusTrapTarget, shouldOpenCartDrawer } from "./cart-drawer-model.ts";
import {
  buildSearchOverlayAnnouncement,
  INITIAL_SEARCH_OVERLAY,
  isSearchOverlayQueryReady,
  reduceSearchOverlay,
  resolveSuggestionArrow,
} from "./search-overlay-model.ts";

/**
 * The browser wiring around `search-overlay-model.ts`: the debounced server read, focus, Escape,
 * the Tab trap, arrow keys into the list, and the page's scroll lock. Every decision is the model's.
 */

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';
const DEBOUNCE_MS = 200;

export function useSearchOverlay({
  triggerRef,
  dialogRef,
  inputRef,
  listRef,
}: Readonly<{
  triggerRef: RefObject<HTMLAnchorElement | null>;
  dialogRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLUListElement | null>;
}>) {
  const titleId = useId();
  const listId = useId();
  const [state, dispatch] = useReducer(reduceSearchOverlay, INITIAL_SEARCH_OVERLAY);
  const sequence = useRef(0);

  // One debounced request per pause in typing. Re-running on every `query` change cancels the
  // previous timer, and the model drops any response whose request id or text is no longer current.
  useEffect(() => {
    if (!state.open || state.status !== "loading") return;
    const query = state.query;
    if (!isSearchOverlayQueryReady(query)) return;
    const timer = window.setTimeout(() => {
      sequence.current += 1;
      const requestId = sequence.current;
      dispatch({ type: "REQUEST", requestId });
      searchStorefrontSuggestions(query).then(
        (model) => dispatch({ type: "LOADED", requestId, query, model }),
        () => dispatch({ type: "FAILED", requestId, query }),
      );
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state.open, state.query, state.status]);

  useEffect(() => {
    if (state.focus === null) return;
    (state.focus === "opener" ? triggerRef.current : inputRef.current)?.focus();
    dispatch({ type: "FOCUS_HANDLED" });
  }, [state.focus, triggerRef, inputRef]);

  useEffect(() => {
    if (!state.open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [state.open]);

  const onTriggerClick = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    // Same rule as the cart drawer: only a plain primary click opens it; the rest keep the link.
    if (!shouldOpenCartDrawer(event)) return;
    event.preventDefault();
    dispatch({ type: "OPEN" });
  }, []);

  const close = useCallback(() => dispatch({ type: "CLOSE" }), []);

  const onInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: "INPUT", text: event.target.value });
  }, []);

  const onDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const links = Array.from(listRef.current?.querySelectorAll<HTMLElement>("a[href]") ?? []);
        const activeIndex = links.indexOf(document.activeElement as HTMLElement);
        const inList = activeIndex >= 0;
        if (!inList && document.activeElement !== inputRef.current) return;
        const target = resolveSuggestionArrow({ key: event.key, activeIndex, count: links.length });
        if (target === null) return;
        event.preventDefault();
        (target < 0 ? inputRef.current : links[target])?.focus();
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const target = resolveFocusTrapTarget({
        shiftKey: event.shiftKey,
        activeIndex: controls.indexOf(document.activeElement as HTMLElement),
        count: controls.length,
      });
      if (target === null) return;
      event.preventDefault();
      controls[target]?.focus();
    },
    [close, dialogRef, inputRef, listRef],
  );

  return {
    open: state.open,
    query: state.query,
    status: state.status,
    result: state.result,
    announcement: buildSearchOverlayAnnouncement(state),
    titleId,
    listId,
    limits: STOREFRONT_SEARCH_SUGGESTION_LIMITS,
    onTriggerClick,
    onInputChange,
    onDialogKeyDown,
    close,
  };
}
