"use server";

import { listConfiguredStorefrontDiscoveryPage } from "@/commerce/storefront-catalog-runtime";
import {
  loadStorefrontSearchSuggestionCandidates,
  readStorefrontSearchSuggestionsEnabled,
} from "@/commerce/storefront-search-suggestions";

import {
  buildSearchSuggestionsModel,
  type SearchSuggestionsModel,
} from "./search-suggestions-model.ts";

/**
 * The public boundary of search suggestions: one read-only server action.
 *
 * It takes the shopper's text and nothing else. The gate, the bounds and the catalog read are all
 * decided here on the server; the response is the narrow `SearchSuggestionsModel`. With
 * `SEARCH_SUGGESTIONS_ENABLED` off it answers `DISABLED` without touching the database.
 */
export async function searchStorefrontSuggestions(input: unknown): Promise<SearchSuggestionsModel> {
  // The listing's pricing rule is returned by the page read itself and applied to these same
  // products, so a suggestion's price comes from the projection that matched it.
  let pricingRule: Parameters<typeof buildSearchSuggestionsModel>[1];
  const candidates = await loadStorefrontSearchSuggestionCandidates(
    {
      enabled: readStorefrontSearchSuggestionsEnabled(),
      async listDiscoveryPage({ discovery, pageSize, now }) {
        const page = await listConfiguredStorefrontDiscoveryPage({ discovery, pageSize, now });
        pricingRule = page.pricingRule;
        return page;
      },
    },
    input,
  );
  return buildSearchSuggestionsModel(candidates, pricingRule);
}
