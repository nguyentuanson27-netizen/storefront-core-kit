import Image, { getImageProps } from "next/image";

/**
 * The collection's editorial hero. Presentation only: both URLs arrive already validated against the
 * trusted Pancake image contract by the route model.
 *
 * With a mobile crop, art direction is left to the browser through `<picture>`: it evaluates the
 * `<source>` media query and fetches exactly one of the two, so a phone never downloads the desktop
 * photograph and a desktop never downloads the phone crop. That is also why this branch must not use
 * `preload` -- a `<link rel="preload">` cannot express the choice and would fetch both. Priority comes
 * from `fetchPriority` on the element instead, which applies only to the source actually chosen.
 */
export function CollectionHero({
  desktopUrl,
  mobileUrl,
  alt,
}: Readonly<{ desktopUrl: string; mobileUrl: string | null; alt: string }>) {
  if (mobileUrl === null) {
    return (
      <div className="relative mt-10 aspect-[16/9] overflow-hidden bg-[var(--stone)]">
        <Image src={desktopUrl} alt={alt} fill preload sizes="100vw" className="object-cover" />
      </div>
    );
  }

  const common = { alt, fill: true, sizes: "100vw" } as const;
  const {
    props: { srcSet: desktopSrcSet },
  } = getImageProps({ ...common, src: desktopUrl });
  const {
    props: { srcSet: mobileSrcSet, ...mobileImage },
  } = getImageProps({ ...common, src: mobileUrl, loading: "eager", fetchPriority: "high" });

  return (
    <div
      className="relative mt-10 aspect-[4/5] overflow-hidden bg-[var(--stone)] md:aspect-[16/9]"
      data-art-directed-hero=""
    >
      <picture>
        <source media="(min-width: 768px)" srcSet={desktopSrcSet} sizes="100vw" />
        {/* The `<img>` inside `<picture>` is how Next documents art direction with getImageProps:
            next/image cannot render `<source>`, and these props are the optimized ones it built. */}
        <img {...mobileImage} srcSet={mobileSrcSet} alt={alt} className="object-cover" />
      </picture>
    </div>
  );
}
