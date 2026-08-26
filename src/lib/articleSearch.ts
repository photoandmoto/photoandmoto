// Builds the keyword blob that the Aikakone / Time Machine card filter
// matches against. Used at build time only — the result is baked into each
// card's data-search attribute, so the browser never fetches or parses
// anything at runtime.
//
// SCOPE: metadata only (title, subtitle, category, tags). Deliberately NOT
// article body text.
//
// We tried body text and reverted it. The numbers: distilling each article
// to its unique words still pushed /fi/aikakone from ~45 KB to 103 KB, and
// 16 of 22 articles hit the truncation cap anyway — so most articles were
// only partly searchable, with no way for a reader to tell which. Raising
// the cap fixed coverage but not the page weight, which grows with every
// article published.
//
// The deciding argument: Pagefind at /fi/etsi and /en/search already does
// full-text search properly — lazily-loaded chunked index, stemming, ranked
// results, zero cost to pages that don't use it. Embedding a worse copy of
// that in the listing page duplicated the feature and paid for it twice.
//
// So the division of labour is:
//   - this filter  -> fast browse-narrowing on the listing page
//                     ("show me the MXGP ones", "the Carlqvist one")
//   - Pagefind     -> real full-text search, linked from the empty state
//
// If you ever want body search here, reach for Pagefind's JS API rather than
// re-embedding text in the HTML.

/**
 * Builds the data-search value for one article card.
 *
 * Not filtered or deduplicated: metadata is short, and short-but-meaningful
 * terms ("CZ", "SM", "AMA") must survive — a word-length filter would eat
 * exactly the terms this archive cares about.
 */
export function buildArticleSearchText(article: {
  data: {
    title?: string;
    subtitle?: string;
    category?: string;
    tags?: string[];
  };
}): string {
  return [
    article.data.title,
    article.data.subtitle,
    article.data.category,
    ...(article.data.tags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
