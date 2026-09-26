import type { Prisma, PrismaClient } from "../../src/generated/prisma/client.ts";

type CleanupClient = Pick<PrismaClient, "orderMirror" | "capacityReservation" | "capacityReservationResource">;

/**
 * Deletes test orders together with the capacity they reserved.
 *
 * Capacity reservations reference their order with `onDelete: Restrict` on purpose: in production a
 * deleted order must never silently free a hold that still counts. Test fixtures that own the whole
 * order therefore remove its ledger rows first, explicitly, instead of relying on a cascade.
 */
export async function deleteOrdersWithCapacity(
  client: CleanupClient,
  args: { where?: Prisma.OrderMirrorWhereInput } = {},
) {
  const where = args.where ?? {};
  await client.capacityReservationResource.deleteMany({ where: { reservation: { order: where } } });
  await client.capacityReservation.deleteMany({ where: { order: where } });
  return client.orderMirror.deleteMany({ where });
}
