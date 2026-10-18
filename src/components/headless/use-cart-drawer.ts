"use client";

import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";

import { readStorefrontCartDrawer } from "@/routes/cart-drawer";

import {
  INITIAL_CART_DRAWER,
  reduceCartDrawer,
  resolveFocusTrapTarget,
  shouldOpenCartDrawer,
} from "./cart-drawer-model.ts";

/**
 * The browser wiring around `cart-drawer-model.ts`: the server read, focus, Escape, the Tab trap
 * and the page's scroll lock. Every decision is the model's; this turns DOM events into its inputs.
 */

const FOCUSABLE = 'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function useCartDrawer({
  triggerRef,
  dialogRef,
}: Readonly<{
  /** The cart link; focus returns here when the drawer closes. */
  triggerRef: RefObject<HTMLAnchorElement | null>;
  dialogRef: RefObject<HTMLDivElement | null>;
}>) {
  const titleId = useId();
  const [state, dispatch] = useReducer(reduceCartDrawer, INITIAL_CART_DRAWER);
  const sequence = useRef(0);
  // Whether a read is in flight for the current open. The reducer also ignores a second OPEN while
  // loading, but it runs after this function has already called the server, so two activations in
  // the same tick (Enter held, a double tap, a scripted click) would otherwise cost two reads. This
  // guard is synchronous, so the second one never reaches the network.
  const inFlight = useRef(false);

  const load = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    sequence.current += 1;
    const requestId = sequence.current;
    // Only the read that is still current may release the guard: a late answer from a read that was
    // closed over must not unlock a newer one.
    const settle = () => {
      if (sequence.current === requestId) inFlight.current = false;
    };
    dispatch({ type: "OPEN", requestId });
    readStorefrontCartDrawer().then(
      (view) => {
        settle();
        dispatch({ type: "LOADED", requestId, view });
      },
      () => {
        settle();
        dispatch({ type: "FAILED", requestId });
      },
    );
  }, []);

  const onTriggerClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (!shouldOpenCartDrawer(event)) return;
      event.preventDefault();
      load();
    },
    [load],
  );

  const close = useCallback(() => {
    // Closing abandons the read in flight (its answer is dropped by the reducer), so opening again
    // is allowed to start a fresh one.
    inFlight.current = false;
    dispatch({ type: "CLOSE" });
  }, []);

  useEffect(() => {
    if (state.focus === null) return;
    if (state.focus === "opener") triggerRef.current?.focus();
    else dialogRef.current?.focus();
    dispatch({ type: "FOCUS_HANDLED" });
  }, [state.focus, triggerRef, dialogRef]);

  useEffect(() => {
    if (!state.open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [state.open]);

  const onDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
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
    [close, dialogRef],
  );

  return {
    open: state.open,
    status: state.status,
    view: state.view,
    titleId,
    onTriggerClick,
    close,
    retry: load,
    onDialogKeyDown,
  };
}
