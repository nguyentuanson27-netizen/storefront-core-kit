/**
 * Admin editing of a product's selling policy (spec: docs/specs/core-kit-selling-modes-v1.md §10.1).
 *
 * The service decides what may be written; the form is a convenience. It re-validates everything the
 * browser submits, takes the actor from the authenticated session (never from the form), and refuses
 * the whole change when any rule fails:
 *
 * - a non-`STANDARD` mode while `SELLING_MODES_ENABLED` is off, and `PREORDER` unless
 *   `SELLING_MODE_PREORDER_ENABLED` is also on;
 * - a non-`STANDARD` mode for a product that has a composite parent variant (§6.1).
 *
 * These gates are a convenience too. The authority is `effectivePolicy()`, so a row saved while a flag
 * was on stops affecting sales the moment that flag is off (§4.2.1).
 */

import { requireAdminSession } from "../auth/authorization.ts";

import {
  parseSellingPolicyChange,
  type SellingModeFlags,
  type SellingPolicyChange,
} from "./selling-policy.ts";

export const SELLING_POLICY_ADMIN_LIMITS = { productId: 128 } as const;

type AdminSessionCandidate =
  | { user: { id: string; role?: string | null }; session: { id: string } }
  | null
  | undefined;

export type SellingPolicyUpdateRefusal =
  | "INVALID_INPUT"
  | "PRODUCT_NOT_FOUND"
  | "SELLING_MODES_DISABLED"
  | "PREORDER_DISABLED"
  | "COMPOSITE_MODE_UNSUPPORTED";

export type SellingPolicyUpdateResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: SellingPolicyUpdateRefusal }>;

type SellingPolicyAdminDependencies = {
  readFlags(): SellingModeFlags;
  productExists(productId: string): Promise<boolean>;
  productHasCompositeParent(productId: string): Promise<boolean>;
  saveSellingPolicy(productId: string, change: SellingPolicyChange, actorUserId: string): Promise<void>;
};

function parseProductId(value: unknown): string | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > SELLING_POLICY_ADMIN_LIMITS.productId
    || value !== value.trim()
  ) {
    return null;
  }
  return value;
}

export function createSellingPolicyAdminService(dependencies: SellingPolicyAdminDependencies) {
  async function update(
    session: AdminSessionCandidate,
    input: Readonly<{ productId: unknown; sellingMode: unknown; negativeStockLimit: unknown }>,
  ): Promise<SellingPolicyUpdateResult> {
    const admin = requireAdminSession(session);

    const productId = parseProductId(input.productId);
    const change = parseSellingPolicyChange(input);
    if (productId === null || change === null) return { ok: false, reason: "INVALID_INPUT" };

    if (change.kind === "SET" && change.sellingMode !== "STANDARD") {
      const flags = dependencies.readFlags();
      if (!flags.sellingModesEnabled) return { ok: false, reason: "SELLING_MODES_DISABLED" };
      if (change.sellingMode === "PREORDER" && !flags.preorderEnabled) {
        return { ok: false, reason: "PREORDER_DISABLED" };
      }
    }

    if (!(await dependencies.productExists(productId))) return { ok: false, reason: "PRODUCT_NOT_FOUND" };

    if (
      change.kind === "SET"
      && change.sellingMode !== "STANDARD"
      && (await dependencies.productHasCompositeParent(productId))
    ) {
      return { ok: false, reason: "COMPOSITE_MODE_UNSUPPORTED" };
    }

    await dependencies.saveSellingPolicy(productId, change, admin.user.id);
    return { ok: true };
  }

  return { update };
}
