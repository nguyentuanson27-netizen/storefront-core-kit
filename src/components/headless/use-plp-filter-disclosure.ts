"use client";

import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import {
  INITIAL_PLP_FILTER_DISCLOSURE,
  isPlpFilterPanelVisible,
  isPlpFilterTriggerVisible,
  reducePlpFilterDisclosure,
  resolvePlpChipRemovalFocus,
} from "./plp-filter-model.ts";

/**
 * The wiring around `plp-filter-model.ts` that cannot be pure: a media query, two refs, focus and an
 * Escape handler. Every decision -- collapsed or not, where focus goes -- is the reducer's.
 *
 * `stateKey` identifies the listing's filter state (the route's canonical `stateHref`). When it
 * changes the listing has re-rendered for a new state, which closes an open panel.
 */

export type UsePlpFilterDisclosureInput = Readonly<{
  /** The route's canonical page-one href for the current filter state. */
  stateKey: string;
  /** At or above this the panel is never collapsed. The brand's breakpoint, e.g. `(min-width: 1024px)`. */
  wideQuery: string;
  /** Chip keys in render order, for focus after a removal. */
  chipKeys?: readonly string[];
  /** The collapse button, the panel and the chip list. Owned by the component that renders them. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  chipsRef: RefObject<HTMLUListElement | null>;
}>;

export function usePlpFilterDisclosure({
  stateKey,
  wideQuery,
  chipKeys = [],
  triggerRef,
  panelRef,
  chipsRef,
}: UsePlpFilterDisclosureInput) {
  const panelId = useId();
  const [state, dispatch] = useReducer(reducePlpFilterDisclosure, INITIAL_PLP_FILTER_DISCLOSURE);
  const pendingChipFocus = useRef<{ key: string | null } | null>(null);
  const previousStateKey = useRef(stateKey);

  useEffect(() => {
    const query = window.matchMedia(wideQuery);
    const report = () => dispatch({ type: "VIEWPORT", wide: query.matches });
    report();
    query.addEventListener("change", report);
    return () => query.removeEventListener("change", report);
  }, [wideQuery]);

  useEffect(() => {
    if (previousStateKey.current === stateKey) return;
    previousStateKey.current = stateKey;
    dispatch({ type: "NAVIGATED" });

    const pending = pendingChipFocus.current;
    if (pending === null) return;
    pendingChipFocus.current = null;
    const target =
      pending.key === null
        ? null
        : chipsRef.current?.querySelector<HTMLElement>(`[data-plp-chip="${CSS.escape(pending.key)}"]`);
    // No chip left to take focus: the trigger when there is one, else the panel's first control.
    (target ?? triggerRef.current ?? firstControl(panelRef.current))?.focus();
  }, [stateKey, triggerRef, panelRef, chipsRef]);

  useEffect(() => {
    if (state.focus === null) return;
    (state.focus === "trigger" ? triggerRef.current : firstControl(panelRef.current))?.focus();
    dispatch({ type: "FOCUS_HANDLED" });
  }, [state.focus, triggerRef, panelRef]);

  const toggle = useCallback(() => dispatch({ type: "TOGGLE" }), []);


  const onPanelKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (event.key !== "Escape") return;
    // The reducer ignores Escape unless this is an open, collapsed panel, so it never swallows the
    // key from a native select or a wide layout where nothing is collapsed.
    dispatch({ type: "ESCAPE" });
  }, []);

  /** Call from a chip's click, before the navigation it starts. */
  const noteChipRemoval = useCallback(
    (removedKey: string) => {
      pendingChipFocus.current = { key: resolvePlpChipRemovalFocus(chipKeys, removedKey) };
    },
    [chipKeys],
  );

  const panelVisible = isPlpFilterPanelVisible(state);

  return {
    ready: state.ready,
    open: state.open,
    panelVisible,
    triggerVisible: isPlpFilterTriggerVisible(state),
    triggerProps: {
      type: "button" as const,
      "aria-expanded": panelVisible,
      "aria-controls": panelId,
      onClick: toggle,
    },
    panelProps: {
      id: panelId,
      hidden: !panelVisible,
      onKeyDown: onPanelKeyDown,
    },
    noteChipRemoval,
  };
}

function firstControl(panel: HTMLElement | null): HTMLElement | null {
  return panel?.querySelector<HTMLElement>("input, select, textarea, button") ?? null;
}
