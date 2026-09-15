/**
 * The gallery's seam, as a type-level obligation.
 *
 * Checked on the props type's **keys**, not by assigning the component to a function type. Function
 * parameters are contravariant, so a gallery declaring only `{ media }` is assignable to a type
 * taking the full input — an assignment check passes for a component that accepts none of the
 * selection. Keys are what the obligation is actually about.
 */
import { BrandProductGallery } from "@/components/brand/product-gallery";
import type { GalleryModelInput } from "@/components/headless/resolve-gallery-model";

type GalleryProps = Parameters<typeof BrandProductGallery>[0];

/** Every field of the resolved selection must be accepted -- `selectedVariantId` above all. */
type MissingFromProps = Exclude<keyof Omit<GalleryModelInput, "manualSelection">, keyof GalleryProps>;
const acceptsResolvedSelection: [MissingFromProps] extends [never] ? true : never = true;

/** …and the gallery owns its own manual pick rather than taking one it would overwrite. */
const ownsItsManualPick: "manualSelection" extends keyof GalleryProps ? never : true = true;

export const contract = [acceptsResolvedSelection, ownsItsManualPick];
