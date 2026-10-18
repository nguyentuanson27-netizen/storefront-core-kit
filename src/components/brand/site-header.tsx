import Link from "next/link";

import { BRAND, NAVIGATION } from "@/brand";
import { CartDrawerTrigger } from "@/components/brand/cart-drawer";
import { SearchOverlayTrigger } from "@/components/brand/search-overlay";

export function SiteHeader({
  cartDrawer = false,
  searchOverlay = false,
}: Readonly<{ cartDrawer?: boolean; searchOverlay?: boolean }>) {
  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">
        Bỏ qua đến nội dung chính
      </a>

      <div className="nav-shell">
        <Link className="brand-mark" href="/" aria-label={NAVIGATION.brandHomeLabel}>
          {BRAND.identity.displayNameUpper}
        </Link>

        <nav className="desktop-nav" aria-label="Điều hướng chính">
          {NAVIGATION.primary.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mobile-nav">
          <details>
            <summary>Menu</summary>
            <nav className="mobile-menu" aria-label="Điều hướng chính trên di động">
              {[...NAVIGATION.primary, ...NAVIGATION.mobileUtility].map((item) =>
                searchOverlay && item.href === "/search" ? (
                  <SearchOverlayTrigger key={item.href} href={item.href} label={item.label} />
                ) : (
                  <Link key={item.href} href={item.href}>
                    {item.label}
                  </Link>
                ),
              )}
            </nav>
          </details>
        </div>

        <nav className="utility-nav" aria-label="Tiện ích">
          {NAVIGATION.utility.map((item) =>
            cartDrawer && item.href === "/cart" ? (
              <CartDrawerTrigger key={item.href} href={item.href} label={item.label} />
            ) : searchOverlay && item.href === "/search" ? (
              <SearchOverlayTrigger key={item.href} href={item.href} label={item.label} />
            ) : (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </header>
  );
}
