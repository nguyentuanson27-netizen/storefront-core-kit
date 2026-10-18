import {
  parseStorefrontDiscoverySearchParams,
  STOREFRONT_DISCOVERY_LIMITS,
  type StorefrontDiscoveryQuery,
} from "./storefront-discovery.ts";

/**
 * The bounded read behind search suggestions (A/B/C plan B07, spec B5).
 *
 * It is deliberately not a search engine. A suggestion is the first few rows of the canonical
 * `/shop` discovery read for the same `q`, so what is hidden, unpublished, stale, priced or out of
 * stock is decided by the one catalog authority and cannot drift from the listing a shopper lands
 * on after choosing "see all". Nothing here owns a URL, a filter, a sort or a price.
 *
 * The capability is a server-side gate, default OFF. With the gate off the loader answers
 * `DISABLED` before it validates the query or reaches the catalog, so a deployment that never
 * enables it pays no query for it and `/search` and `/shop` behave exactly as before.
 */

export const STOREFRONT_SEARCH_SUGGESTION_LIMITS = Object.freeze({
  /** Below this a prefix matches too much of the catalog to be a suggestion, only a scan. */
  minQueryLength: 2,
  /** The same bound `/shop` applies to `q`, so a suggested query is always a valid listing query. */
  maxQueryLength: STOREFRONT_DISCOVERY_LIMITS.query,
  maxSuggestions: 6,
  /** The caller stops waiting after this; a slow catalog read yields no suggestions, not a stall. */
  timeoutMs: 1_500,
});

export type StorefrontSearchSuggestionFailure =
  | "DISABLED"
  | "QUERY_TOO_SHORT"
  | "INVALID_QUERY"
  | "UNAVAILABLE";

/** What the catalog read must return; the real repository's discovery page satisfies it. */
export type StorefrontSearchSuggestionPage<Product> = Readonly<{
  products: readonly Product[];
  totalCount: number;
}>;

export type StorefrontSearchSuggestionCandidates<Product> =
  | Readonly<{
      ok: true;
      query: string;
      /** Never more than `maxSuggestions`, in the catalog's own name order. */
      products: readonly Product[];
      /** The full match count of the canonical listing, for a "see all" affordance. */
      totalCount: number;
      /** The canonical `/shop` discovery state this query maps to. */
      discovery: StorefrontDiscoveryQuery;
    }>
  | Readonly<{ ok: false; reason: StorefrontSearchSuggestionFailure }>;

export type StorefrontSearchSuggestionDependencies<Product> = Readonly<{
  enabled: boolean;
  /** The canonical discovery read, called with a fixed small page size. */
  listDiscoveryPage(input: {
    discovery: StorefrontDiscoveryQuery;
    pageSize: number;
    now: Date;
  }): Promise<StorefrontSearchSuggestionPage<Product>>;
  now?: () => Date;
  timeoutMs?: number;
}>;

/** Strictly `"true"` turns the capability on; anything else, including unset, is OFF. */
export function readStorefrontSearchSuggestionsEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.SEARCH_SUGGESTIONS_ENABLED === "true";
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

type ParsedSuggestionQuery =
  | Readonly<{ ok: true; query: string; discovery: StorefrontDiscoveryQuery }>
  | Readonly<{ ok: false; reason: "QUERY_TOO_SHORT" | "INVALID_QUERY" }>;

/**
 * Accepts only what `/shop` would accept for `q`, then applies the suggestion minimum.
 *
 * The browser input is `unknown`: a non-string, an oversized string and a control character are all
 * refused rather than coerced or truncated, because a truncated query would suggest products the
 * shopper never asked for.
 */
export function parseStorefrontSearchSuggestionQuery(raw: unknown): ParsedSuggestionQuery {
  if (typeof raw !== "string") return { ok: false, reason: "INVALID_QUERY" };
  if (CONTROL_CHARACTERS.test(raw)) return { ok: false, reason: "INVALID_QUERY" };

  let discovery: StorefrontDiscoveryQuery;
  try {
    // The one parser for `q`: trimming, empty-as-absent and the length bound are not re-implemented.
    discovery = parseStorefrontDiscoverySearchParams({ q: raw });
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, reason: "INVALID_QUERY" };
    throw error;
  }

  const query = discovery.query;
  if (query === null || query.length < STOREFRONT_SEARCH_SUGGESTION_LIMITS.minQueryLength) {
    return { ok: false, reason: "QUERY_TOO_SHORT" };
  }
  return { ok: true, query, discovery };
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("search suggestions timed out")), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function loadStorefrontSearchSuggestionCandidates<Product>(
  dependencies: StorefrontSearchSuggestionDependencies<Product>,
  rawQuery: unknown,
): Promise<StorefrontSearchSuggestionCandidates<Product>> {
  // First, and before anything is validated or read: OFF costs nothing.
  if (!dependencies.enabled) return { ok: false, reason: "DISABLED" };

  const parsed = parseStorefrontSearchSuggestionQuery(rawQuery);
  if (!parsed.ok) return parsed;

  const now = (dependencies.now ?? (() => new Date()))();
  const timeoutMs = dependencies.timeoutMs ?? STOREFRONT_SEARCH_SUGGESTION_LIMITS.timeoutMs;

  try {
    const page = await withTimeout(
      dependencies.listDiscoveryPage({
        discovery: parsed.discovery,
        pageSize: STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxSuggestions,
        now,
      }),
      timeoutMs,
    );
    // The page size is the bound, but the cap is enforced again here so a dependency that returns
    // more can never widen what leaves this function.
    const products = page.products.slice(0, STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxSuggestions);
    return {
      ok: true,
      query: parsed.query,
      products: Object.freeze(products),
      totalCount: Math.max(page.totalCount, products.length),
      discovery: parsed.discovery,
    };
  } catch {
    // A failure or a timeout is "no suggestions", never a thrown error with catalog internals.
    return { ok: false, reason: "UNAVAILABLE" };
  }
}
