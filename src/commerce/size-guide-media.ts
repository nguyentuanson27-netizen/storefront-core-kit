/**
 * Optional trusted media for the configured size-guide charts (B06): validation, no storage.
 *
 * A chart image is an addition to an approved table, never a replacement and never a fit claim.
 * The trust rule is not new: the URL must pass `parseTrustedProductImageUrl` (HTTPS, the single
 * reviewed Pancake CDN host, no port or credentials, the reviewed path shape, `.jpg/.png/.webp`), so
 * no host is introduced and nothing about image delivery is decided here. The guide key must be a
 * chart the brand configuration declares; a key that is not is refused rather than stored.
 */

import { parseTrustedProductImageUrl } from "./product-media.ts";

export const SIZE_GUIDE_MEDIA_MAX_ALT_LENGTH = 300;
export const SIZE_GUIDE_MEDIA_MAX_DIMENSION = 8000;
export const SIZE_GUIDE_MEDIA_MAX_URL_LENGTH = 2048;

/** Strictly `"true"` turns the chart images on; anything else, including unset, is OFF. */
export function readSizeGuideMediaEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.SIZE_GUIDE_MEDIA_ENABLED === "true";
}

export type SizeGuideMedia = Readonly<{
  guideKey: string;
  imageUrl: string;
  altText: string;
  width: number;
  height: number;
}>;

export type SizeGuideMediaRefusal =
  | "UNKNOWN_GUIDE"
  | "UNTRUSTED_IMAGE"
  | "INVALID_ALT"
  | "INVALID_DIMENSIONS";

export type SizeGuideMediaParse =
  | Readonly<{ ok: true; media: SizeGuideMedia }>
  | Readonly<{ ok: false; reason: SizeGuideMediaRefusal }>;

export const SIZE_GUIDE_MEDIA_MESSAGES: Readonly<Record<SizeGuideMediaRefusal | "INVALID", string>> = {
  INVALID: "Dữ liệu không hợp lệ. Tải lại trang rồi thử lại.",
  UNKNOWN_GUIDE: "Bảng size này không tồn tại trong cấu hình.",
  UNTRUSTED_IMAGE: "Ảnh phải là liên kết HTTPS từ nguồn ảnh đã được duyệt (Pancake CDN) với đường dẫn hợp lệ.",
  INVALID_ALT: `Cần mô tả ảnh (alt) từ 1 đến ${SIZE_GUIDE_MEDIA_MAX_ALT_LENGTH} ký tự.`,
  INVALID_DIMENSIONS: `Chiều rộng và chiều cao phải là số nguyên từ 1 đến ${SIZE_GUIDE_MEDIA_MAX_DIMENSION}.`,
};

export function readSizeGuideMediaReason(value: unknown): SizeGuideMediaRefusal | "INVALID" {
  return typeof value === "string" && Object.hasOwn(SIZE_GUIDE_MEDIA_MESSAGES, value)
    ? (value as SizeGuideMediaRefusal | "INVALID")
    : "INVALID";
}

function parseDimension(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,3}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= SIZE_GUIDE_MEDIA_MAX_DIMENSION ? value : null;
}

/** `knownGuideKeys` are the chart ids of the brand's size-guide configuration. */
export function parseSizeGuideMediaInput(
  input: Readonly<{ guideKey: unknown; imageUrl: unknown; altText: unknown; width: unknown; height: unknown }>,
  knownGuideKeys: readonly string[],
): SizeGuideMediaParse {
  if (typeof input.guideKey !== "string" || !knownGuideKeys.includes(input.guideKey)) {
    return { ok: false, reason: "UNKNOWN_GUIDE" };
  }

  const imageUrl = parseTrustedProductImageUrl(input.imageUrl);
  if (imageUrl === null || imageUrl.length > SIZE_GUIDE_MEDIA_MAX_URL_LENGTH) {
    return { ok: false, reason: "UNTRUSTED_IMAGE" };
  }

  const altText = typeof input.altText === "string" ? input.altText.trim() : "";
  if (altText.length < 1 || altText.length > SIZE_GUIDE_MEDIA_MAX_ALT_LENGTH) {
    return { ok: false, reason: "INVALID_ALT" };
  }

  const width = parseDimension(input.width);
  const height = parseDimension(input.height);
  if (width === null || height === null) return { ok: false, reason: "INVALID_DIMENSIONS" };

  return { ok: true, media: { guideKey: input.guideKey, imageUrl, altText, width, height } };
}

/**
 * The media the page may render: only for configured charts, and only if the stored URL still passes
 * the trust rule. A row that no longer passes (the rule tightened, or the chart id was removed from
 * the configuration) is dropped silently, so a stale row can never put an untrusted image on the page.
 */
export function selectRenderableSizeGuideMedia(
  rows: readonly SizeGuideMedia[],
  knownGuideKeys: readonly string[],
): ReadonlyMap<string, SizeGuideMedia> {
  const result = new Map<string, SizeGuideMedia>();
  for (const row of rows) {
    if (!knownGuideKeys.includes(row.guideKey) || result.has(row.guideKey)) continue;
    const imageUrl = parseTrustedProductImageUrl(row.imageUrl);
    if (imageUrl === null) continue;
    result.set(row.guideKey, { ...row, imageUrl });
  }
  return result;
}
