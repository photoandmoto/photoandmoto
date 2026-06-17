// POST /api/request-access
//
// Avustaja access-request flow — step 1 of 2. A visitor fills the "Pyydä
// käyttöoikeutta" form on /fi/toimitus. We store the request in D1 with a
// random token and email the REQUESTOR a verification link. Only after they
// click it (handled by /api/verify-access-request) is the editor notified.
//
// Same-origin check + 3/IP/hour rate limit reduce drive-by abuse.

import {
  getJsonBody, getClientIp, jsonResponse, errorResponse, corsOptionsResponse,
} from '../_lib/auth.js';

const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory rate limit: max 3 requests per IP per hour (best-effort).
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map();
function checkRateLimit(ip, now) {
  const recent = (rateBuckets.get(ip) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) { rateBuckets.set(ip, recent); return false; }
  recent.push(now);
  rateBuckets.set(ip, recent);
  if (rateBuckets.size > 500) {
    for (const [k, v] of rateBuckets) {
      const f = v.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
      if (f.length) rateBuckets.set(k, f); else rateBuckets.delete(k);
    }
  }
  return true;
}

function isSameOrigin(request) {
  const host = new URL(request.url).host;
  for (const header of ['Origin', 'Referer']) {
    const value = request.headers.get(header);
    if (value) { try { return new URL(value).host === host; } catch { return false; } }
  }
  return false;
}
function validEmail(e) {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return errorResponse('Pyyntö hylätty (väärä alkuperä)', 403);
  if (!env.DB) return errorResponse('Tietokantaa ei ole määritetty', 500);
  if (!env.RESEND_API_KEY) return errorResponse('Sähköpostipalvelua ei ole määritetty', 500);

  if (!checkRateLimit(getClientIp(request) || 'unknown', Date.now())) {
    return errorResponse('Liian monta pyyntöä. Yritä myöhemmin uudelleen.', 429);
  }

  const body = await getJsonBody(request);
  const name = (body?.name || '').toString().trim();
  const email = (body?.email || '').toString().trim();
  const reason = (body?.reason || '').toString().trim();

  if (name.length < 2 || name.length > 100) return errorResponse('Anna nimesi', 400);
  if (!validEmail(email)) return errorResponse('Anna kelvollinen sähköpostiosoite', 400);
  if (!reason) return errorResponse('Kerro miksi haluat kirjoittaa', 400);
  if (reason.length > 500) return errorResponse('Perustelu on liian pitkä (enintään 500 merkkiä)', 400);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO access_requests (name, email, reason, token, verified, created_at, expires_at)
       VALUES (?, ?, ?, ?, 0, datetime('now'), ?)`
    ).bind(name, email, reason, token, expiresAt).run();
  } catch (e) {
    console.error('access_requests insert failed:', e);
    return errorResponse('Pyynnön tallennus epäonnistui — yritä myöhemmin uudelleen', 500);
  }

  // Canonical, environment-aware base URL (not the raw request host, which may
  // be a per-deploy preview domain) so the verification link is always clean.
  const isProd = env.CF_PAGES_BRANCH === 'main';
  const baseUrl = isProd ? 'https://www.photoandmoto.fi' : 'https://photoandmoto-staging.pages.dev';
  const verifyUrl = `${baseUrl}/fi/vahvista-pyynto?token=${token}`;
  const text =
`Hei ${name},

Olet pyytänyt Avustaja-käyttöoikeutta Photo & Moto -sivustolle.

Vahvista pyyntösi klikkaamalla alla olevaa linkkiä:
${verifyUrl}

Linkki vanhenee 24 tunnin kuluttua.

Jos et pyytänyt tätä, voit jättää viestin huomiotta.`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: 'Vahvista käyttöoikeuspyyntösi — Photo & Moto',
        text,
      }),
    });
    if (!res.ok) {
      console.error('Resend error (request-access):', res.status, await res.text().catch(() => ''));
      return errorResponse('Vahvistusviestin lähetys epäonnistui — yritä myöhemmin uudelleen', 502);
    }
  } catch (e) {
    console.error('request-access threw:', e);
    return errorResponse('Vahvistusviestin lähetys epäonnistui — yritä myöhemmin uudelleen', 502);
  }

  return jsonResponse({ ok: true });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
