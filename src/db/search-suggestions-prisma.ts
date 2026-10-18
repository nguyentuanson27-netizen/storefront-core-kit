import type { PrismaClient } from "../generated/prisma/client.ts";
import { createBudgetedPrismaClient } from "./budgeted-prisma.ts";

/**
 * The client search suggestions read through (A/B/C plan B07): the same database, but every
 * statement is cancelled by Postgres after `SUGGESTION_STATEMENT_TIMEOUT_MS`, on a pool of at most
 * `SUGGESTION_MAX_CONNECTIONS`. Created on first use so a deployment that never enables suggestions
 * never opens a second pool.
 */

/** Matches `STOREFRONT_SEARCH_SUGGESTION_LIMITS.timeoutMs`: the caller stops waiting as Postgres stops working. */
export const SUGGESTION_STATEMENT_TIMEOUT_MS = 1_500;
export const SUGGESTION_MAX_CONNECTIONS = 4;
export const SUGGESTION_CONNECTION_TIMEOUT_MS = 1_000;

const globalForSuggestions = globalThis as unknown as {
  searchSuggestionsPrisma?: PrismaClient;
};

export function getSearchSuggestionsPrisma(): PrismaClient {
  if (globalForSuggestions.searchSuggestionsPrisma) return globalForSuggestions.searchSuggestionsPrisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be configured on the server");
  }

  const client = createBudgetedPrismaClient({
    connectionString,
    statementTimeoutMs: SUGGESTION_STATEMENT_TIMEOUT_MS,
    maxConnections: SUGGESTION_MAX_CONNECTIONS,
    connectionTimeoutMs: SUGGESTION_CONNECTION_TIMEOUT_MS,
  });
  globalForSuggestions.searchSuggestionsPrisma = client;
  return client;
}
