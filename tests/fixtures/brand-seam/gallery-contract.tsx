/**
 * The gallery's seam, as a type-level obligation.
 *
 * Compare the props object type directly instead of assigning the component to a function type.
 * Function parameters are contravariant, so component assignment can accept a gallery that declares
 * too little. Object-level assignability checks both the required keys and their value types.
 */
import { BrandProductGallery } from "@/components/brand/product-gallery";
import type { GalleryModelInput } from "@/components/headless/resolve-gallery-model";

type GalleryProps = Parameters<typeof BrandProductGallery>[0];
type ResolvedGalleryInput = Omit<GalleryModelInput, "manualSelection">;

/** The full resolved selection/model input must be assignable to the brand gallery props. */
const acceptsResolvedSelection: ResolvedGalleryInput extends GalleryProps ? true : never = true;

/** …and the gallery owns its own manual pick rather than taking one it would overwrite. */
const ownsItsManualPick: "manualSelection" extends keyof GalleryProps ? never : true = true;

export const contract = [acceptsResolvedSelection, ownsItsManualPick];
