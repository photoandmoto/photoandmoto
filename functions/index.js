/**
 * Root path (/) redirect — runs only on exact "/" requests.
 *
 * Logic (first match wins):
 *   1. Bots (Googlebot, Bingbot, social previewers, etc.) → /fi/
 *      Photo & Moto is a Finnish site primarily; FI should be the canonical
 *      home that search engines and link previews resolve to.
 *   2. Cloudflare's `CF-IPCountry` geo header:
 *        FI → /fi/
 *        anything else (including unknown XX) → /en/
 *
 * Deliberately stateless: no cookie persistence, no lang_pref tracking.
 * Reasoning: a manual toggle to EN is "let me read this one in English right
 * now," not "make English my permanent default." Auto-persisting that choice
 * traps Finnish-speaking users on /en/ the next day after they happened to
 * click EN once. Geo is the source of truth for "where am I from."
 *
 * All redirects are 302 (temporary) so search engines don't permanently
 * cache a per-IP locale. Canonical + hreflang link rels on each page do the
 * SEO heavy lifting.
 *
 * Edge cases:
 *   - Sharing a deep link like /fi/aikakone/<slug> is unaffected — this
 *     function only fires on exact path "/".
 *   - VPN / mobile-carrier mis-classification: user clicks the FI/EN toggle
 *     to read the version they want. No persistence; if it matters they can
 *     bookmark the explicit URL.
 */
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 1. Bots → /fi/
  const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();
  const isBot =
    /bot|crawler|spider|scraper|googlebot|bingbot|yandex|baidu|duckduckbot|slurp|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|applebot/i.test(
      userAgent
    );
  if (isBot) {
    return Response.redirect(`${url.origin}/fi/`, 302);
  }

  // 2. Geo
  const country = request.headers.get('CF-IPCountry') || 'XX';
  const target = country === 'FI' ? '/fi/' : '/en/';
  return Response.redirect(`${url.origin}${target}`, 302);
}
