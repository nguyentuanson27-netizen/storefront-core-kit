import type { CartDrawerView } from "../../routes/cart-drawer-model.ts";

/**
 * The state and keyboard rules of a cart drawer, as pure functions.
 *
 * Nothing here knows a price, a quantity rule or a stock fact: the drawer renders the
 * `CartDrawerView` the server produced, and this file decides only when it is open, which response
 * is allowed to fill it, and where keyboard focus goes. A brand supplies the markup and the words.
 *
 * Two rules are the point. A response that arrives after the drawer was closed, or after a newer
 * open, is dropped, so an old cart can never overwrite a newer one. And every open starts from
 * `loading` with no view, so a drawer never shows the contents it had last time as if they were
 * current.
 */

export type CartDrawerStatus = "idle" | "loading" | "ready" | "error";

export type CartDrawerFocusIntent = "dialog" | "opener" | null;

export type CartDrawerState = Readonly<{
  open: boolean;
  status: CartDrawerStatus;
  /** The open that this state is waiting on; a response for any other id is stale. */
  requestId: number;
  view: CartDrawerView | null;
  focus: CartDrawerFocusIntent;
}>;

export type CartDrawerEvent =
  | Readonly<{ type: "OPEN"; requestId: number }>
  | Readonly<{ type: "LOADED"; requestId: number; view: CartDrawerView | null }>
  | Readonly<{ type: "FAILED"; requestId: number }>
  | Readonly<{ type: "CLOSE" }>
  | Readonly<{ type: "FOCUS_HANDLED" }>;

export const INITIAL_CART_DRAWER: CartDrawerState = Object.freeze({
  open: false,
  status: "idle",
  requestId: 0,
  view: null,
  focus: null,
});

export function reduceCartDrawer(state: CartDrawerState, event: CartDrawerEvent): CartDrawerState {
  switch (event.type) {
    case "OPEN":
      // A second activation while the first read is in flight changes nothing: no second request,
      // no flicker. Retrying after a failure is allowed.
      if (state.open && state.status === "loading") return state;
      return Object.freeze({
        open: true,
        status: "loading",
        requestId: event.requestId,
        view: null,
        focus: state.open ? state.focus : "dialog",
      });

    case "LOADED":
      if (!state.open || event.requestId !== state.requestId) return state;
      // `null` is the server saying the capability is off; there is nothing to show.
      if (event.view === null) return Object.freeze({ ...state, status: "error", view: null });
      return Object.freeze({ ...state, status: "ready", view: event.view });

    case "FAILED":
      if (!state.open || event.requestId !== state.requestId) return state;
      return Object.freeze({ ...state, status: "error", view: null });

    case "CLOSE":
      if (!state.open) return state;
      return Object.freeze({ ...state, open: false, status: "idle", view: null, focus: "opener" });

    case "FOCUS_HANDLED":
      return state.focus === null ? state : Object.freeze({ ...state, focus: null });
  }
}

/**
 * Where Tab goes inside an open dialog, as an index into its focusable controls, or `null` to let
 * the browser move focus normally. Only the two edges need handling: forward from the last control
 * wraps to the first, backward from the first wraps to the last, and focus that has somehow left
 * the dialog is pulled back in.
 */
export function resolveFocusTrapTarget(input: {
  shiftKey: boolean;
  activeIndex: number;
  count: number;
}): number | null {
  const { shiftKey, activeIndex, count } = input;
  if (!Number.isSafeInteger(count) || count < 1) return null;
  const last = count - 1;
  if (!Number.isSafeInteger(activeIndex) || activeIndex < 0 || activeIndex > last) {
    return shiftKey ? last : 0;
  }
  if (shiftKey && activeIndex === 0) return last;
  if (!shiftKey && activeIndex === last) return 0;
  return null;
}

/**
 * Whether a click on the cart link should open the drawer or be left to the browser.
 *
 * Only a plain primary click opens it. Cmd/Ctrl/Shift/Alt-click and middle-click mean "open /cart
 * in a new tab or window", and honouring that keeps the link a real link.
 */
export function shouldOpenCartDrawer(click: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return !click.defaultPrevented
    && click.button === 0
    && !click.metaKey
    && !click.ctrlKey
    && !click.shiftKey
    && !click.altKey;
}
