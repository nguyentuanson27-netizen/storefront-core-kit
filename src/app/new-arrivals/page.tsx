import Link from "next/link";

import { ProductCard, type ProductCardTone } from "@/components/brand/product-card";
import { createStorefrontRoute } from "@/routes/factory";
import { buildNewArrivalsMetadata } from "@/routes/metadata/new-arrivals";
import {
  loadNewArrivalsRoute,
  type NewArrivalsRouteProps,
  type NewArrivalsViewModel,
} from "@/routes/new-arrivals";

/**
 * The drop announcement. With `NEW_ARRIVALS_CURATION_ENABLED` off it lists nothing: `/shop` owns
 * filtering and ordering. With it on, the administrator's curated selection follows the same
 * editorial frame, from the same card projection `/shop` renders.
 */

const tones: readonly ProductCardTone[] = ["stone", "olive", "ink", "sand"];

const linkClassName =
  "inline-flex min-h-11 items-center text-xs font-semibold uppercase tracking-[0.14em] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4";

function render({ curated }: NewArrivalsViewModel) {
  return (
    <div className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
      <p className="eyebrow">Drop / 01</p>
      <h1 className="mt-4 max-w-6xl text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
        HÀNG MỚI
      </h1>
      <div className="mt-12 border-t border-black/20 pt-8">
        <p className="max-w-2xl font-serif text-2xl leading-snug md:text-3xl">
          Những phom dáng, chất liệu và lớp trang phục theo mùa mới nhất — được ra mắt với số lượng chọn lọc.
        </p>
      </div>

      {curated === null ? null : curated.empty ? (
        <section className="mt-16 border-t border-black/20 py-12" aria-labelledby="new-arrivals-empty-title">
          <h2 id="new-arrivals-empty-title" className="font-serif text-2xl leading-tight md:text-3xl">
            Sản phẩm mới
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-6 text-black/65" role="status">
            Chưa có sản phẩm mới để hiển thị. Vui lòng quay lại sau.
          </p>
          {curated.nextHref ? (
            <Link className={`mt-6 ${linkClassName}`} href={curated.nextHref} rel="next">
              Trang sau →
            </Link>
          ) : null}
        </section>
      ) : (
        <section className="mt-16" aria-labelledby="new-arrivals-products-title">
          <div className="section-heading-row border-t border-black/20 pt-5">
            <h2 id="new-arrivals-products-title">Sản phẩm mới</h2>
            {curated.totalPages > 1 ? (
              <p className="eyebrow">
                Trang {curated.page}/{curated.totalPages}
              </p>
            ) : null}
          </div>
          <div className="product-grid">
            {curated.cards.map((card, index) => (
              <ProductCard
                key={card.id}
                model={card.model}
                tone={tones[(curated.toneOffset + index) % tones.length]!}
              />
            ))}
          </div>

          {curated.totalPages > 1 ? (
            <nav
              className="mt-12 flex items-center justify-between gap-4 border-t border-black/20 pt-6"
              aria-label="Phân trang hàng mới"
            >
              {curated.previousHref ? (
                <Link className={linkClassName} href={curated.previousHref} rel="prev">
                  ← Trang trước
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
              {curated.nextHref ? (
                <Link className={linkClassName} href={curated.nextHref} rel="next">
                  Trang sau →
                </Link>
              ) : null}
            </nav>
          ) : null}
        </section>
      )}
    </div>
  );
}

const route = createStorefrontRoute<NewArrivalsRouteProps, NewArrivalsViewModel>({
  load: loadNewArrivalsRoute,
  render,
  // A direct call to the canonical builder: the route contract accepts no other shape here.
  metadata: (props) => buildNewArrivalsMetadata(props),
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
