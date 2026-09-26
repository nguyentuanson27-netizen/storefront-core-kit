import assert from "node:assert/strict";
import test from "node:test";

import { syncPancakeCatalog } from "../../src/commerce/catalog-sync.ts";

type Query = Readonly<Record<string, string | number | boolean>>;

function catalogPage(pageNumber: number, totalPages: number) {
  return {
    success: true,
    page_number: pageNumber,
    page_size: 100,
    total_entries: 0,
    total_pages: totalPages,
    data: [],
  };
}

function emptyCompositePage() {
  return {
    success: true,
    page_number: 1,
    page_size: 100,
    total_entries: 0,
    total_pages: 0,
    data: [],
  };
}

test("catalog sync completes catalog and composite traversals before handing one snapshot to persistence", async () => {
  const events: string[] = [];
  const client = {
    async getJson(_endpoint: string, query: Query) {
      const role = query.included_composite;
      if (role === "parent" || role === "children") {
        events.push(`composite:${role}`);
        return emptyCompositePage();
      }
      const page = Number(query.page_number);
      events.push(`fetch:${page}`);
      return catalogPage(page, 2);
    },
  };
  const repository = {
    async syncSnapshot(input: {
      shopId: number;
      variations: readonly unknown[];
      compositeSnapshot: {
        parentVariationIds: readonly string[];
        componentVariationIds: readonly string[];
        parentIdentities: readonly unknown[];
        componentIdentities: readonly unknown[];
        edges: readonly unknown[];
      };
      syncedAt: Date;
    }) {
      events.push("persist");
      assert.equal(input.shopId, 123);
      assert.deepEqual(input.variations, []);
      assert.deepEqual(input.compositeSnapshot, {
        parentVariationIds: [],
        componentVariationIds: [],
        parentIdentities: [],
        componentIdentities: [],
        edges: [],
      });
      assert.deepEqual(input.syncedAt, new Date("2026-08-11T00:00:00.000Z"));
      return { products: 0, variations: 0 };
    },
  };

  const result = await syncPancakeCatalog({
    client,
    repository,
    shopId: 123,
    clock: () => new Date("2026-08-11T00:00:00.000Z"),
  });

  assert.deepEqual(events, [
    "fetch:1",
    "fetch:2",
    "composite:parent",
    "composite:children",
    "persist",
  ]);
  assert.deepEqual(result, { products: 0, variations: 0 });
});

test("catalog sync never mutates the mirror when any catalog page fails validation", async () => {
  let persisted = false;
  const client = {
    async getJson(_endpoint: string, query: Query) {
      const page = Number(query.page_number);
      return page === 1
        ? catalogPage(1, 2)
        : { ...catalogPage(2, 2), success: false };
    },
  };
  const repository = {
    async syncSnapshot() {
      persisted = true;
      return { products: 0, variations: 0 };
    },
  };

  await assert.rejects(
    () =>
      syncPancakeCatalog({
        client,
        repository,
        shopId: 123,
        clock: () => new Date("2026-08-11T00:00:00.000Z"),
      }),
    /unsuccessful/i,
  );
  assert.equal(persisted, false);
});

test("catalog sync never mutates the mirror when the composite traversal fails validation", async () => {
  let persisted = false;
  const client = {
    async getJson(_endpoint: string, query: Query) {
      if (query.included_composite === "parent") {
        return { ...emptyCompositePage(), total_entries: 0, data: [{}] };
      }
      if (query.included_composite === "children") return emptyCompositePage();
      return catalogPage(1, 0);
    },
  };
  const repository = {
    async syncSnapshot() {
      persisted = true;
      return { products: 0, variations: 0 };
    },
  };

  await assert.rejects(
    () =>
      syncPancakeCatalog({
        client,
        repository,
        shopId: 123,
        clock: () => new Date("2026-08-11T00:00:00.000Z"),
      }),
    /composite pagination/i,
  );
  assert.equal(persisted, false);
});

test("catalog sync samples its stock-observation marker before any Pancake request", async () => {
  const events: Array<"clock" | "request"> = [];
  const client = {
    async getJson(_endpoint: string, query: Query) {
      events.push("request");
      if (query.included_composite !== undefined) return emptyCompositePage();
      return catalogPage(1, 0);
    },
  };
  const repository = {
    async syncSnapshot() {
      return { products: 0, variations: 0 };
    },
  };

  await syncPancakeCatalog({
    client,
    repository,
    shopId: 123,
    clock: () => {
      // Pins ordering, not a value: a marker read after the fetch would still carry a plausible time.
      assert.equal(events.length, 0, "the clock must be sampled before the first Pancake request");
      events.push("clock");
      return new Date("2026-08-11T00:00:00.000Z");
    },
  });

  assert.equal(events[0], "clock");
  assert.equal(events.filter((event) => event === "clock").length, 1);
});
