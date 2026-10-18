import assert from "node:assert/strict";
import test from "node:test";

import {
  loadStorefrontSearchSuggestionCandidates,
  parseStorefrontSearchSuggestionQuery,
  readStorefrontSearchSuggestionsEnabled,
  STOREFRONT_SEARCH_SUGGESTION_LIMITS,
  type StorefrontSearchSuggestionDependencies,
} from "../../src/commerce/storefront-search-suggestions.ts";
import { STOREFRONT_DISCOVERY_LIMITS } from "../../src/commerce/storefront-discovery.ts";

/** B07 — the bounded search-suggestion loader: gate, query bounds, page bound, failure shape. */

type Product = Readonly<{ slug: string }>;

function deps(
  overrides: Partial<StorefrontSearchSuggestionDependencies<Product>> = {},
): StorefrontSearchSuggestionDependencies<Product> & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    enabled: true,
    async listDiscoveryPage(input) {
      calls.push(input);
      return { products: [{ slug: "a" }, { slug: "b" }], totalCount: 2 };
    },
    ...overrides,
    calls,
  };
}

test("the gate is OFF unless SEARCH_SUGGESTIONS_ENABLED is exactly \"true\"", () => {
  assert.equal(readStorefrontSearchSuggestionsEnabled({}), false);
  for (const value of ["", "false", "TRUE", "1", "yes", " true", "true "]) {
    assert.equal(readStorefrontSearchSuggestionsEnabled({ SEARCH_SUGGESTIONS_ENABLED: value }), false, value);
  }
  assert.equal(readStorefrontSearchSuggestionsEnabled({ SEARCH_SUGGESTIONS_ENABLED: "true" }), true);
});

test("OFF answers DISABLED before validating the query or reading the catalog", async () => {
  const d = deps({ enabled: false });
  for (const input of ["áo sơ mi", "", 42, null, "x".repeat(500)]) {
    assert.deepEqual(await loadStorefrontSearchSuggestionCandidates(d, input), {
      ok: false,
      reason: "DISABLED",
    });
  }
  assert.equal(d.calls.length, 0);
});

test("a query is trimmed and must reach the minimum length", () => {
  assert.deepEqual(
    (({ ok, query }) => ({ ok, query }))(parseStorefrontSearchSuggestionQuery("  áo  ") as never),
    { ok: true, query: "áo" },
  );
  for (const input of ["", "   ", "a", " a "]) {
    assert.deepEqual(parseStorefrontSearchSuggestionQuery(input), { ok: false, reason: "QUERY_TOO_SHORT" }, input);
  }
  assert.equal(STOREFRONT_SEARCH_SUGGESTION_LIMITS.minQueryLength, 2);
});

test("a query longer than /shop accepts is refused, never truncated", () => {
  const max = STOREFRONT_DISCOVERY_LIMITS.query;
  assert.equal(STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxQueryLength, max);
  assert.equal(parseStorefrontSearchSuggestionQuery("a".repeat(max)).ok, true);
  assert.deepEqual(parseStorefrontSearchSuggestionQuery("a".repeat(max + 1)), {
    ok: false,
    reason: "INVALID_QUERY",
  });
});

test("non-strings and control characters are invalid, not coerced", () => {
  for (const input of [undefined, null, 12, true, {}, ["áo"], "áo\u0000", "áo\n", "\u007fáo"]) {
    assert.deepEqual(parseStorefrontSearchSuggestionQuery(input), { ok: false, reason: "INVALID_QUERY" });
  }
});

test("the suggested query maps to the canonical /shop discovery state and nothing else", async () => {
  const d = deps();
  const result = await loadStorefrontSearchSuggestionCandidates(d, "  sơ mi ");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.query, "sơ mi");
  assert.deepEqual(result.discovery, {
    query: "sơ mi",
    color: null,
    size: null,
    availability: null,
    minPriceVnd: null,
    maxPriceVnd: null,
    collection: null,
    sort: "name-asc",
    page: 1,
  });
});

test("the catalog is read once with a fixed small page size and the caller's clock", async () => {
  const instant = new Date("2026-10-18T00:00:00.000Z");
  const d = deps({ now: () => instant });
  await loadStorefrontSearchSuggestionCandidates(d, "áo");
  assert.equal(d.calls.length, 1);
  const call = d.calls[0] as { pageSize: number; now: Date; discovery: { page: number } };
  assert.equal(call.pageSize, STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxSuggestions);
  assert.equal(call.now, instant);
  assert.equal(call.discovery.page, 1);
});

test("a dependency that returns too many rows cannot widen the response", async () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ slug: `p-${i}` }));
  const result = await loadStorefrontSearchSuggestionCandidates(
    deps({ listDiscoveryPage: async () => ({ products: many, totalCount: 50 }) }),
    "áo",
  );
  assert.equal(result.ok && result.products.length, STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxSuggestions);
  assert.equal(result.ok && result.totalCount, 50);
});

test("zero matches is a successful empty list", async () => {
  const result = await loadStorefrontSearchSuggestionCandidates(
    deps({ listDiscoveryPage: async () => ({ products: [], totalCount: 0 }) }),
    "zzz",
  );
  assert.deepEqual(result.ok && [result.products.length, result.totalCount], [0, 0]);
});

test("a failing catalog read is UNAVAILABLE and leaks nothing", async () => {
  const result = await loadStorefrontSearchSuggestionCandidates(
    deps({
      async listDiscoveryPage() {
        throw new Error("password authentication failed for user \"postgres\"");
      },
    }),
    "áo",
  );
  assert.deepEqual(result, { ok: false, reason: "UNAVAILABLE" });
});

test("a read slower than the timeout is UNAVAILABLE and does not stall the caller", async () => {
  const started = Date.now();
  const result = await loadStorefrontSearchSuggestionCandidates(
    deps({
      timeoutMs: 20,
      listDiscoveryPage: () => new Promise(() => {}),
    }),
    "áo",
  );
  assert.deepEqual(result, { ok: false, reason: "UNAVAILABLE" });
  assert.ok(Date.now() - started < 1_000);
});

test("the default timeout is a short finite bound", () => {
  assert.ok(Number.isSafeInteger(STOREFRONT_SEARCH_SUGGESTION_LIMITS.timeoutMs));
  assert.ok(STOREFRONT_SEARCH_SUGGESTION_LIMITS.timeoutMs > 0);
  assert.ok(STOREFRONT_SEARCH_SUGGESTION_LIMITS.timeoutMs <= 3_000);
  assert.ok(STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxSuggestions <= 10);
});
