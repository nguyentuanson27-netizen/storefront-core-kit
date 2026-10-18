import assert from "node:assert/strict";
import test from "node:test";

import {
  NEW_ARRIVALS_MAX_ITEMS,
  NEW_ARRIVALS_MAX_PAGES,
  NEW_ARRIVALS_PAGE_SIZE,
  computeNewArrivalsPaging,
  newArrivalsPagePath,
  parseNewArrivalsPage,
} from "../../src/commerce/new-arrivals-paging.ts";

test("B01 the approved constants hold and the page ceiling is derived", () => {
  assert.equal(NEW_ARRIVALS_PAGE_SIZE, 24);
  assert.equal(NEW_ARRIVALS_MAX_ITEMS, 500);
  assert.equal(NEW_ARRIVALS_MAX_PAGES, 21);
});

test("B01 the page parser follows the accepted table", () => {
  const ok = (page: number) => ({ ok: true, page });
  assert.deepEqual(parseNewArrivalsPage(undefined), ok(1));
  assert.deepEqual(parseNewArrivalsPage(""), ok(1));
  assert.deepEqual(parseNewArrivalsPage("1"), ok(1));
  assert.deepEqual(parseNewArrivalsPage("2"), ok(2));
  assert.deepEqual(parseNewArrivalsPage("21"), ok(21));

  for (const bad of [
    "0", "-1", "01", "1.5", "1e3", "+2", " 2", "2 ", "abc", "٢", "22", "9007199254740993",
    "99999999999999999999999", "0x10", "2\n",
  ]) {
    assert.deepEqual(parseNewArrivalsPage(bad), { ok: false }, JSON.stringify(bad));
  }
  assert.deepEqual(parseNewArrivalsPage(["2", "3"]), { ok: false }, "repeated parameter");
  assert.deepEqual(parseNewArrivalsPage(["2"]), { ok: false }, "an array is never a single value");
});

test("B01 paging boundaries for 0 / 1 / 23 / 24 / 25 / 48 / 49 / 500 stored slots", () => {
  const pages = (count: number) => computeNewArrivalsPaging(count, 1)?.totalPages;
  assert.equal(pages(0), 1, "an empty selection still has its one page");
  assert.equal(pages(1), 1);
  assert.equal(pages(23), 1);
  assert.equal(pages(24), 1);
  assert.equal(pages(25), 2);
  assert.equal(pages(48), 2);
  assert.equal(pages(49), 3);
  assert.equal(pages(500), 21);
});

test("B01 offsets are rank based and contiguous across pages", () => {
  assert.deepEqual(computeNewArrivalsPaging(49, 1), { totalPages: 3, offset: 0, limit: 24 });
  assert.deepEqual(computeNewArrivalsPaging(49, 2), { totalPages: 3, offset: 24, limit: 24 });
  assert.deepEqual(computeNewArrivalsPaging(49, 3), { totalPages: 3, offset: 48, limit: 24 });
  assert.deepEqual(computeNewArrivalsPaging(500, 21), { totalPages: 21, offset: 480, limit: 24 });
});

test("B01 a page past the stored slots, or an impossible count, is out of range", () => {
  assert.equal(computeNewArrivalsPaging(0, 2), null);
  assert.equal(computeNewArrivalsPaging(24, 2), null);
  assert.equal(computeNewArrivalsPaging(25, 3), null);
  assert.equal(computeNewArrivalsPaging(500, 22), null);
  assert.equal(computeNewArrivalsPaging(501, 1), null);
  assert.equal(computeNewArrivalsPaging(-1, 1), null);
  assert.equal(computeNewArrivalsPaging(1.5, 1), null);
  assert.equal(computeNewArrivalsPaging(10, 0), null);
});

test("B01 page 1 is the bare path and later pages carry ?page=N", () => {
  assert.equal(newArrivalsPagePath(1), "/new-arrivals");
  assert.equal(newArrivalsPagePath(2), "/new-arrivals?page=2");
  assert.equal(newArrivalsPagePath(21), "/new-arrivals?page=21");
});
