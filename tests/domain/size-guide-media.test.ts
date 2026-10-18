import assert from "node:assert/strict";
import test from "node:test";

import {
  SIZE_GUIDE_MEDIA_MAX_ALT_LENGTH,
  SIZE_GUIDE_MEDIA_MAX_DIMENSION,
  SIZE_GUIDE_MEDIA_MESSAGES,
  parseSizeGuideMediaInput,
  readSizeGuideMediaEnabled,
  readSizeGuideMediaReason,
  selectRenderableSizeGuideMedia,
} from "../../src/commerce/size-guide-media.ts";

const KNOWN = ["relaxed-and-elastic-waist", "slim-fit"];
const GOOD_URL = "https://content.pancake.vn/1/2/3/4/photo-1.jpg";

const input = (overrides: Record<string, unknown> = {}) => ({
  guideKey: "slim-fit",
  imageUrl: GOOD_URL,
  altText: "Sơ đồ đo ngực và dài áo",
  width: "1200",
  height: "800",
  ...overrides,
});

test("B06 the flag is strictly the string true and OFF by default", () => {
  assert.equal(readSizeGuideMediaEnabled({}), false);
  assert.equal(readSizeGuideMediaEnabled({ SIZE_GUIDE_MEDIA_ENABLED: "true" }), true);
  for (const other of ["True", "1", "yes", " true", "false", ""]) {
    assert.equal(readSizeGuideMediaEnabled({ SIZE_GUIDE_MEDIA_ENABLED: other }), false, JSON.stringify(other));
  }
});

test("B06 a trusted image for a configured chart is accepted and normalized", () => {
  const parsed = parseSizeGuideMediaInput(input(), KNOWN);
  assert.deepEqual(parsed, {
    ok: true,
    media: { guideKey: "slim-fit", imageUrl: GOOD_URL, altText: "Sơ đồ đo ngực và dài áo", width: 1200, height: 800 },
  });
  const trimmed = parseSizeGuideMediaInput(input({ altText: "  Sơ đồ  " }), KNOWN);
  assert.ok(trimmed.ok);
  assert.equal(trimmed.media.altText, "Sơ đồ");
});

test("B06 unknown guide ids are refused", () => {
  for (const guideKey of ["", "nope", "SLIM-FIT", undefined, null, 1, ["slim-fit"]]) {
    assert.deepEqual(parseSizeGuideMediaInput(input({ guideKey }), KNOWN), { ok: false, reason: "UNKNOWN_GUIDE" });
  }
});

test("B06 untrusted images are refused: scheme, host, port, credentials, traversal, type, shape", () => {
  const untrusted = [
    "http://content.pancake.vn/1/2/3/4/photo-1.jpg",
    "https://example.com/1/2/3/4/photo-1.jpg",
    "https://content.pancake.vn.evil.test/1/2/3/4/photo-1.jpg",
    "https://content.pancake.vn:8443/1/2/3/4/photo-1.jpg",
    "https://user:pw@content.pancake.vn/1/2/3/4/photo-1.jpg",
    "https://content.pancake.vn/1/2/3/../photo-1.jpg",
    "https://content.pancake.vn/1/2/3/4/photo-1.svg",
    "https://content.pancake.vn/1/2/3/4/photo-1.gif",
    "https://content.pancake.vn/photo-1.jpg",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "//content.pancake.vn/1/2/3/4/photo-1.jpg",
    "/1/2/3/4/photo-1.jpg",
    "",
    "   ",
    `https://content.pancake.vn/${"a/".repeat(2100)}photo.jpg`,
    42,
    null,
    undefined,
  ];
  for (const imageUrl of untrusted) {
    assert.deepEqual(
      parseSizeGuideMediaInput(input({ imageUrl }), KNOWN),
      { ok: false, reason: "UNTRUSTED_IMAGE" },
      JSON.stringify(imageUrl)?.slice(0, 80),
    );
  }
});

test("B06 alt text is required and bounded", () => {
  for (const altText of ["", "   ", undefined, 5, "x".repeat(SIZE_GUIDE_MEDIA_MAX_ALT_LENGTH + 1)]) {
    assert.deepEqual(parseSizeGuideMediaInput(input({ altText }), KNOWN), { ok: false, reason: "INVALID_ALT" });
  }
  assert.equal(parseSizeGuideMediaInput(input({ altText: "x".repeat(SIZE_GUIDE_MEDIA_MAX_ALT_LENGTH) }), KNOWN).ok, true);
});

test("B06 dimensions are canonical positive integers within the bound", () => {
  assert.equal(parseSizeGuideMediaInput(input({ width: "1", height: String(SIZE_GUIDE_MEDIA_MAX_DIMENSION) }), KNOWN).ok, true);
  for (const bad of ["0", "-1", "1.5", "01", "8001", "1e3", " 5", "", undefined, 5]) {
    assert.deepEqual(parseSizeGuideMediaInput(input({ width: bad }), KNOWN), { ok: false, reason: "INVALID_DIMENSIONS" }, JSON.stringify(bad));
    assert.deepEqual(parseSizeGuideMediaInput(input({ height: bad }), KNOWN), { ok: false, reason: "INVALID_DIMENSIONS" }, JSON.stringify(bad));
  }
});

test("B06 stored rows are re-checked at render: stale, untrusted or unconfigured rows are dropped", () => {
  const row = (guideKey: string, imageUrl: string) => ({ guideKey, imageUrl, altText: "a", width: 10, height: 10 });
  const result = selectRenderableSizeGuideMedia(
    [
      row("slim-fit", GOOD_URL),
      row("relaxed-and-elastic-waist", "https://example.com/1/2/3/4/photo-1.jpg"),
      row("removed-chart", GOOD_URL),
      row("slim-fit", "https://content.pancake.vn/1/2/3/4/second.jpg"),
    ],
    KNOWN,
  );
  assert.deepEqual([...result.keys()], ["slim-fit"]);
  assert.equal(result.get("slim-fit")!.imageUrl, GOOD_URL, "the first valid row for a chart wins");
});

test("B06 only known reasons reach the page; anything else collapses to the generic message", () => {
  for (const reason of Object.keys(SIZE_GUIDE_MEDIA_MESSAGES)) {
    assert.equal(readSizeGuideMediaReason(reason), reason);
  }
  for (const hostile of ["<script>", "toString", "__proto__", undefined, ["UNKNOWN_GUIDE"], 1]) {
    assert.equal(readSizeGuideMediaReason(hostile), "INVALID");
  }
});
