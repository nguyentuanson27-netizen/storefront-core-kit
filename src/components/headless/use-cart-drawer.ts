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

  const load = useCallback(() => {
    sequence.current += 1;
    const requestId = sequence.current;
    dispatch({ type: "OPEN", requestId });
    readStorefrontCartDrawer().then(
      (view) => dispatch({ type: "LOADED", requestId, view }),
      () => dispatch({ type: "FAILED", requestId }),
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

  const close = useCallback(() => dispatch({ type: "CLOSE" }), []);

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
