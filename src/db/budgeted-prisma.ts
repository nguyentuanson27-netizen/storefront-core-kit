import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client.ts";

/**
 * A Prisma client whose every statement runs under a database-side time budget, on a small pool of
 * its own.
 *
 * An application-level timeout (a `Promise.race`) only stops the caller *waiting*: the statement
 * keeps running in Postgres and keeps holding a pooled connection. For an unauthenticated,
 * keystroke-driven read that is the wrong failure mode, because a burst of slow requests would pile
 * up work and starve the shared pool that checkout depends on. Here Postgres itself cancels a
 * statement that exceeds `statementTimeoutMs`, and the separate pool caps how many such reads can
 * be in flight at all, so the cost to the rest of the application is bounded in both time and
 * connections.
 */

export type BudgetedPrismaOptions = Readonly<{
  connectionString: string;
  /** Postgres cancels any single statement that runs longer than this. */
  statementTimeoutMs: number;
  /** Most connections this client may hold; reads beyond it queue rather than opening more. */
  maxConnections: number;
  /** How long a read waits for a free connection before giving up. */
  connectionTimeoutMs: number;
}>;

export function createBudgetedPrismaClient(options: BudgetedPrismaOptions): PrismaClient {
  const { connectionString, statementTimeoutMs, maxConnections, connectionTimeoutMs } = options;
  for (const [name, value] of Object.entries({ statementTimeoutMs, maxConnections, connectionTimeoutMs })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer`);
    }
  }

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      statement_timeout: statementTimeoutMs,
      max: maxConnections,
      connectionTimeoutMillis: connectionTimeoutMs,
      idleTimeoutMillis: 30_000,
    }),
  });
}
