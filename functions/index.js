/**
 * Root path (/) redirect — runs only on exact "/" requests.
 *
 * Precedence (first match wins):
 *   1. `lang_pref` cookie (explicit user preference set by language toggle
 *      or by visiting any /fi/* or /en/* page) → honor it
 *   2. Bots (Googlebot, Bingbot, etc.) → always /fi/ so FI is indexed as canonical
 *   3. Cloudflare's `CF-IPCountry` geo header
 *        FI → /fi/
 *        anything else (incl. XX for unknown) → /en/
 *
 * All redirects are 302 (temporary) so search engines don't permanently cache
 * a wrong locale per IP. Bots get 302 too — the canonical link rel handles
 * canonicalisation, not the redirect status code.
 *
 * Edge cases handled by design:
 *   - VPN / corporate proxy / mobile carrier quirks may make a real Finn
 *     appear as a foreign country. The user can correct this by clicking the
 *     FI/EN toggle once — the `lang_pref` cookie is written and wins on every
 *     subsequent visit.
 *   - Sharing a deep link like /fi/aikakone/<slug> is unaffected — this
 *     function only fires on exact path "/".
 */
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 1. Honor explicit preference cookie
  const cookieHeader = request.headers.get('Cookie') || '';
  const langPrefMatch = cookieHeader.match(/(?:^|;\s*)lang_pref=(fi|en)/);
  if (langPrefMatch) {
    return Response.redirect(`${url.origin}/${langPrefMatch[1]}/`, 302);
  }

  // 2. Bots → /fi/ (canonical Finnish site for indexing)
  const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();
  const isBot =
    /bot|crawler|spider|scraper|googlebot|bingbot|yandex|baidu|duckduckbot|slurp|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|applebot/i.test(
      userAgent
    );
  if (isBot) {
    return Response.redirect(`${url.origin}/fi/`, 302);
  }

  // 3. Cloudflare geo header
  const country = request.headers.get('CF-IPCountry') || 'XX';
  const target = country === 'FI' ? '/fi/' : '/en/';
  return Response.redirect(`${url.origin}${target}`, 302);
}
