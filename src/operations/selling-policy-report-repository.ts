/**
 * Reads what the selling-policy operator report prints (spec: docs/specs/core-kit-selling-modes-v1.md §10.3).
 *
 * Policy rows come from the policy repository, the table's only reader; capacity comes from the same
 * resource plan as the storefront's advisory figure. Kept out of both repositories so neither has to
 * import the other.
 */

import { readAdvisoryCapacityResources } from "../commerce/capacity-reservation-repository.ts";
import { createSellingPolicyRepository } from "../commerce/selling-policy-repository.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";

import type { SellingPolicyReportRow } from "./selling-policy-report.ts";

export async function readSellingPolicyReportRows(client: PrismaClient): Promise<SellingPolicyReportRow[]> {
  const products = await createSellingPolicyRepository(client).readStoredPolicyProducts();
  const capacity = await readAdvisoryCapacityResources(
    client,
    products.flatMap((product) => product.variants.map(({ variantId }) => variantId)),
  );
  return products.map((product) => ({
    ...product,
    variants: product.variants.map((variant) => ({
      ...variant,
      capacityResources: capacity.get(variant.variantId) ?? null,
    })),
  }));
}
