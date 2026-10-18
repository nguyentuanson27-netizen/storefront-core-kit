"use client";

import { useRef, type ReactNode } from "react";

import type { StorefrontProductMedia } from "@/commerce/product-media";
import { BrandProductGallery } from "@/components/brand/product-gallery";
import { focusMissingOption, PdpStickyPurchaseBar } from "@/components/brand/pdp-sticky-purchase-bar";
import { PurchasePanelView } from "@/components/brand/purchase-panel";
import { resolvePurchaseCtaState } from "@/components/headless/pdp-mobile-interaction-model";
import { usePdpStickyBar } from "@/components/headless/use-pdp-mobile-interactions";
import {
  useVariantSelection,
  type UseVariantSelectionInput,
} from "@/components/headless/use-variant-selection";

/**
 * The product detail's client coordinator: one selection, two components.
 *
 * `useVariantSelection` is called here and only here. The panel renders that controller, and the
 * gallery is handed the variant it resolved plus the product's server-built variant-to-gallery map,
 * so choosing a colour moves the photograph. Calling the hook inside each component instead would
 * give the page two selections that drift apart on the first click.
 *
 * Everything static about the product -- the heading, the editorial copy, the size and care notes --
 * stays server-rendered and arrives through the two slots, so becoming a client component here does
 * not drag the whole article across the boundary.
 */

type BrandProductDetailProps = Readonly<{
  selection: UseVariantSelectionInput;
  media: StorefrontProductMedia;
  productName: string;
  /** Server-resolved from a `?variant=` deep link; the gallery clamps anything out of range. */
  initialGalleryIndex: number;
  galleryIndexByVariantId: Readonly<Record<string, number>>;
  /**
   * Server-resolved (`PDP_MOBILE_INTERACTIONS_ENABLED`, default off): gallery swipe and keys, and a
   * sticky purchase bar on narrow viewports. Off, this renders exactly what it always has.
   */
  mobileInteractions?: boolean;
  beforePanel: ReactNode;
  afterPanel: ReactNode;
}>;

export function BrandProductDetail({
  selection,
  media,
  productName,
  initialGalleryIndex,
  galleryIndexByVariantId,
  mobileInteractions = false,
  beforePanel,
  afterPanel,
}: BrandProductDetailProps) {
  const controller = useVariantSelection(selection);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cta = resolvePurchaseCtaState({
    view: controller.view,
    selection: controller.selection,
    isPending: controller.isPending,
  });
  const stickyBar = usePdpStickyBar({
    enabled: mobileInteractions,
    panelRef,
    wideQuery: "(min-width: 1024px)",
    ctaKind: cta.kind,
  });

  return (
    <div className={`${mobileInteractions ? "max-lg:pb-24 " : ""}mt-7 grid min-w-0 gap-10 border-t border-black/20 pt-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16`}>
      <BrandProductGallery
        media={media}
        productName={productName}
        initialIndex={initialGalleryIndex}
        selectedVariantId={controller.view.selectedVariantId}
        galleryIndexByVariantId={galleryIndexByVariantId}
        mobileInteractions={mobileInteractions}
      />

      <article className="min-w-0 pb-10 lg:pt-4">
        {beforePanel}
        <div className="mt-10" ref={panelRef}>
          <PurchasePanelView controller={controller} />
        </div>
        {afterPanel}
      </article>
      {stickyBar.visible ? (
        <PdpStickyPurchaseBar
          cta={cta}
          price={controller.view.priceDisplay}
          message={controller.message}
          onAdd={controller.addToBag}
          onChoose={(key) => focusMissingOption(panelRef.current, key)}
        />
      ) : null}
    </div>
  );
}
