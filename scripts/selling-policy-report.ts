import { prisma } from "../src/db/prisma.ts";
import { createSellingPolicyRepository } from "../src/commerce/selling-policy-repository.ts";
import { readSellingModeFlags } from "../src/commerce/selling-policy.ts";
import { buildSellingPolicyReport, formatSellingPolicyReport } from "../src/operations/selling-policy-report.ts";

/**
 * `pnpm catalog:selling-policy:report` — every product with a stored selling policy, what it sells as
 * right now under this deployment's flags, and the per-variant capacity it is working with.
 */
try {
  const flags = readSellingModeFlags();
  const rows = await createSellingPolicyRepository(prisma).readSellingPolicyReport();
  console.log(formatSellingPolicyReport(buildSellingPolicyReport(rows, flags), flags));
} finally {
  await prisma.$disconnect();
}
