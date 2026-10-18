"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import {
  resolveGalleryKey,
  resolveGalleryNavigation,
  resolveGalleryStep,
  resolveStickyBarVisible,
  resolveSwipeDirection,
  type GalleryDirection,
  type PurchaseCtaKind,
} from "./pdp-mobile-interaction-model.ts";

/**
 * The browser wiring around `pdp-mobile-interaction-model.ts`: pointer and key events for the
 * gallery, and a viewport/intersection observer for the sticky purchase bar. Every decision is the
 * model's; these hooks only turn DOM events into its inputs and its outputs into state.
 */

export type UsePdpGalleryControlsInput = Readonly<{
  enabled: boolean;
  activeIndex: number;
  imageCount: number;
  /** Called with the new index when a swipe, key or button moves the frame. */
  onChange: (index: number) => void;
}>;

export function usePdpGalleryControls({ enabled, activeIndex, imageCount, onChange }: UsePdpGalleryControlsInput) {
  const touchStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const navigation = resolveGalleryNavigation(activeIndex, imageCount);

  const step = useCallback(
    (direction: GalleryDirection) => {
      const result = resolveGalleryStep({ activeIndex, imageCount, direction });
      if (result.changed) onChange(result.index);
    },
    [activeIndex, imageCount, onChange],
  );

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    // A mouse drag selects text and drags images; swipe is a touch/pen gesture.
    if (event.pointerType === "mouse") return;
    touchStart.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (start === null) return;
      const direction = resolveSwipeDirection({
        dx: event.clientX - start.x,
        dy: event.clientY - start.y,
        durationMs: event.timeStamp - start.at,
      });
      if (direction !== null) step(direction);
    },
    [step],
  );

  const onPointerCancel = useCallback(() => {
    touchStart.current = null;
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const index = resolveGalleryKey(event.key, { activeIndex, imageCount });
      if (index === null) return;
      event.preventDefault();
      if (index !== activeIndex) onChange(index);
    },
    [activeIndex, imageCount, onChange],
  );

  if (!enabled || imageCount < 2) {
    return { enabled: false as const, navigation, step, frameProps: {} };
  }

  return {
    enabled: true as const,
    navigation,
    step,
    frameProps: {
      tabIndex: 0,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onKeyDown,
      // Vertical drags stay with the page; only horizontal travel is ours to interpret.
      style: { touchAction: "pan-y" as const },
    },
  };
}

export type UsePdpStickyBarInput = Readonly<{
  enabled: boolean;
  /** The element that holds the real purchase panel; the bar shows when it leaves the viewport. */
  panelRef: RefObject<HTMLElement | null>;
  /** At or above this the bar never shows. The brand's breakpoint, e.g. `(min-width: 1024px)`. */
  wideQuery: string;
  ctaKind: PurchaseCtaKind;
}>;

export function usePdpStickyBar({ enabled, panelRef, wideQuery, ctaKind }: UsePdpStickyBarInput) {
  const [ready, setReady] = useState(false);
  const [wide, setWide] = useState(true);
  const [panelIntersecting, setPanelIntersecting] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const query = window.matchMedia(wideQuery);
    const report = () => {
      setWide(query.matches);
      setReady(true);
    };
    report();
    query.addEventListener("change", report);
    return () => query.removeEventListener("change", report);
  }, [enabled, wideQuery]);

  useEffect(() => {
    if (!enabled) return;
    const panel = panelRef.current;
    if (panel === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const latest = entries[entries.length - 1];
        if (latest) setPanelIntersecting(latest.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, [enabled, panelRef]);

  return {
    visible: enabled && resolveStickyBarVisible({ ready, wide, panelIntersecting, ctaKind }),
  };
}
