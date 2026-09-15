import { ShippingPromotionBar } from "@/components/commerce/shipping-promotion-bar";
import { SiteHeader } from "@/components/brand/site-header";

/**
 * The block pinned to the top of every page.
 *
 * Pinned together: the promotion and the nav stay on screen as one block while the page scrolls
 * under them. Sticky rather than fixed, so they still occupy layout space and nothing has to be
 * offset to sit below them.
 */
export function SiteMasthead() {
  return (
    <div className="site-masthead">
      <ShippingPromotionBar />
      <SiteHeader />
    </div>
  );
}
