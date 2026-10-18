/**
 * B07 follow-up — the suggestion client's budget is enforced by Postgres, not just by a caller that
 * stops waiting.
 *
 * A `Promise.race` timeout leaves the statement running and the connection held. These tests show
 * the difference: a slow statement is cancelled server-side (and is no longer active afterwards),
 * the client stays usable, and a one-connection pool really does serialize concurrent reads.
 */

import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createBudgetedPrismaClient } from "../../src/db/budgeted-prisma.ts";
import {
  SUGGESTION_CONNECTION_TIMEOUT_MS,
  SUGGESTION_MAX_CONNECTIONS,
  SUGGESTION_STATEMENT_TIMEOUT_MS,
} from "../../src/db/search-suggestions-prisma.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for database smoke tests");
const connectionString: string = databaseUrl;

const observer = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const created: PrismaClient[] = [];

function budgeted(overrides: Partial<Parameters<typeof createBudgetedPrismaClient>[0]> = {}) {
  const client = createBudgetedPrismaClient({
    connectionString,
    statementTimeoutMs: 150,
    maxConnections: 2,
    connectionTimeoutMs: 1_000,
    ...overrides,
  });
  created.push(client);
  return client;
}

test("a statement over budget is cancelled by Postgres, quickly, with a statement-timeout error", async () => {
  const client = budgeted();
  const started = Date.now();
  await assert.rejects(
    client.$queryRaw`SELECT pg_sleep(3), 'b07-budget-marker'`,
    (error: unknown) => /statement timeout|canceling statement|57014/i.test(String((error as Error).message ?? error)),
  );
  assert.ok(Date.now() - started < 2_000, "returned long before the 3 s the statement asked for");
});

test("the cancelled statement is no longer running in Postgres", async () => {
  const client = budgeted();
  await client.$queryRaw`SELECT pg_sleep(3), 'b07-budget-active-marker'`.catch(() => undefined);
  await delay(200);
  const rows = await observer.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM pg_stat_activity
    WHERE state = 'active'
      AND pid <> pg_backend_pid()
      AND query LIKE '%b07-budget-active-marker%'
  `;
  assert.equal(Number(rows[0]?.n ?? -1), 0, "an app-side timeout alone would leave this statement active");
});

test("the client stays usable after a cancellation, and a fast statement is unaffected", async () => {
  const client = budgeted();
  await client.$queryRaw`SELECT pg_sleep(3)`.catch(() => undefined);
  const rows = await client.$queryRaw<{ one: number }[]>`SELECT 1::int AS one`;
  assert.equal(rows[0]?.one, 1);
});

test("a one-connection pool serializes concurrent reads, so the budget caps in-flight work", async () => {
  const client = budgeted({ statementTimeoutMs: 2_000, maxConnections: 1 });
  const started = Date.now();
  await Promise.all([client.$queryRaw`SELECT pg_sleep(0.4)::text AS s`, client.$queryRaw`SELECT pg_sleep(0.4)::text AS s`]);
  assert.ok(Date.now() - started >= 700, "the second read waited for the only connection");
});

test("option values must be positive integers", () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => createBudgetedPrismaClient({ connectionString, statementTimeoutMs: bad, maxConnections: 2, connectionTimeoutMs: 1_000 }), RangeError);
    assert.throws(() => createBudgetedPrismaClient({ connectionString, statementTimeoutMs: 100, maxConnections: bad, connectionTimeoutMs: 1_000 }), RangeError);
  }
});

test("the suggestion client's constants are small, finite and match the loader's patience", async () => {
  const { STOREFRONT_SEARCH_SUGGESTION_LIMITS } = await import("../../src/commerce/storefront-search-suggestions.ts");
  assert.equal(SUGGESTION_STATEMENT_TIMEOUT_MS, STOREFRONT_SEARCH_SUGGESTION_LIMITS.timeoutMs);
  assert.ok(SUGGESTION_MAX_CONNECTIONS >= 1 && SUGGESTION_MAX_CONNECTIONS <= 8);
  assert.ok(SUGGESTION_CONNECTION_TIMEOUT_MS <= SUGGESTION_STATEMENT_TIMEOUT_MS);
});

test.after(async () => {
  await Promise.all([observer.$disconnect(), ...created.map((client) => client.$disconnect())]);
});
