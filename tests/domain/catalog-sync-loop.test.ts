import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CATALOG_SYNC_INTERVAL_SECONDS,
  parseCatalogSyncIntervalSeconds,
  runCatalogSyncLoop,
} from "../../src/operations/catalog-sync-loop.ts";

test("the sync interval defaults to five minutes and refuses values that would hammer or stall", () => {
  assert.equal(parseCatalogSyncIntervalSeconds(undefined), DEFAULT_CATALOG_SYNC_INTERVAL_SECONDS);
  assert.equal(parseCatalogSyncIntervalSeconds(""), 300);
  assert.equal(parseCatalogSyncIntervalSeconds("60"), 60);
  assert.equal(parseCatalogSyncIntervalSeconds(" 900 "), 900);
  for (const raw of ["0", "59", "86401", "-5", "1.5", "5m", "abc"]) {
    assert.throws(() => parseCatalogSyncIntervalSeconds(raw), RangeError, raw);
  }
});

test("the loop syncs immediately, then once per interval, until stopped", async () => {
  const controller = new AbortController();
  const sleeps: number[] = [];
  let calls = 0;
  const result = await runCatalogSyncLoop({
    sync: async () => {
      calls += 1;
      if (calls === 3) controller.abort();
      return { products: 2, variations: 5 };
    },
    intervalMs: 300_000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    signal: controller.signal,
    log: () => undefined,
  });
  assert.deepEqual(result, { runs: 3, failures: 0 });
  assert.deepEqual(sleeps, [300_000, 300_000]);
});

test("a failed sync is retried next interval and never logs the error it carried", async () => {
  const controller = new AbortController();
  const lines: string[] = [];
  let calls = 0;
  const result = await runCatalogSyncLoop({
    sync: async () => {
      calls += 1;
      if (calls === 1) throw new Error("api_key=SECRET payload");
      controller.abort();
      return { products: 1, variations: 1 };
    },
    intervalMs: 1,
    sleep: async () => undefined,
    signal: controller.signal,
    log: (line) => lines.push(line),
    now: () => new Date("2026-09-27T00:00:00.000Z"),
  });
  assert.deepEqual(result, { runs: 2, failures: 1 });
  assert.equal(lines.some((line) => line.includes("SECRET")), false);
  assert.match(lines[0]!, /catalog sync failed/);
  assert.match(lines[1]!, /catalog sync ok: 1 products, 1 variations/);
});

test("a stop during the wait ends the loop without another sync", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await runCatalogSyncLoop({
    sync: async () => {
      calls += 1;
      return { products: 0, variations: 0 };
    },
    intervalMs: 300_000,
    sleep: async () => controller.abort(),
    signal: controller.signal,
    log: () => undefined,
  });
  assert.deepEqual(result, { runs: 1, failures: 0 });
  assert.equal(calls, 1);
});
