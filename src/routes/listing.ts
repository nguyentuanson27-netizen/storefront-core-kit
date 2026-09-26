/**
 * One navigable listing choice, built by the route and consumed by any presentation.
 *
 * The route owns the listing's URL state: it parses the query, decides what resets the page, and
 * builds every href. A brand may draw these as links, a select, chips or a drawer, but it never
 * merges or removes search params itself; it renders `href` and `active` (spec:
 * core-kit-production-hardening-v1 §9.1).
 */
export type ListingOption<T extends string = string> = Readonly<{
  /** `null` is the "all"/"none" entry of a facet, or a filter's own identity when removing it. */
  value: T | null;
  label: string;
  href: string;
  active: boolean;
}>;
