/**
 * The purchase panel's seam, as a type-level obligation.
 *
 * A brand rewrites `purchase-panel.tsx` freely, so the contract cannot be a pattern its source has
 * to match. What must hold is behavioural: the view accepts a controller someone else owns (or a
 * page cannot drive panel and gallery from one selection), and the standalone panel still accepts
 * the hook's input.
 *
 * Checked on keys and on the controller's type, not by assigning the component to a function type:
 * parameters are contravariant, so an assignment check passes for a view accepting far less than
 * the contract requires.
 */
import { BrandPurchasePanel, PurchasePanelView } from "@/components/brand/purchase-panel";
import type {
  UseVariantSelectionInput,
  VariantSelectionController,
} from "@/components/headless/use-variant-selection";

type ViewProps = Parameters<typeof PurchasePanelView>[0];
type StandaloneProps = Parameters<typeof BrandPurchasePanel>[0];

/** The view must take a controller it does not own… */
const takesAController: "controller" extends keyof ViewProps ? true : never = true;

/** …and it must be the hook's controller, not some narrower shape of its own. */
const takesTheHooksController: VariantSelectionController extends ViewProps["controller"]
  ? true
  : never = true;

/** The standalone panel must remain, so a route that renders it alone is unchanged. */
type MissingFromStandalone = Exclude<keyof UseVariantSelectionInput, keyof StandaloneProps>;
const acceptsHookInput: [MissingFromStandalone] extends [never] ? true : never = true;

export const contract = [takesAController, takesTheHooksController, acceptsHookInput];
