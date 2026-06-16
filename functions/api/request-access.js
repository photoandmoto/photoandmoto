// POST /api/request-access
//
// Public endpoint (no login) for the Yleinen Kynä gate: a visitor without an
// account requests submission access. Emails the editor inbox via Resend. The
// editor then creates the account manually in the Käyttäjät tab.
//
// No CAPTCHA in v1 (per YLEINEN_KYNA.md). A same-origin check + basic input
// validation reduce drive-by abuse; add Turnstile later if needed.

import { getJsonBody, jsonResponse, errorResponse, corsOptionsResponse } from '../_lib/auth.js';

const EDITOR_INBOX = 'photoandmoto@gmail.com';
const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';

function isSameOrigin(request) {
  const host = new URL(request.url).host;
  for (const header of ['Origin', 'Referer']) {
    const value = request.headers.get(header);
    if (value) {
      try { return new URL(value).host === host; } catch { return false; }
    }
  }
  return false;
}

function validEmail(e) {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return errorResponse('Pyyntö hylätty (väärä alkuperä)', 403);
  if (!env.RESEND_API_KEY) return errorResponse('Sähköpostipalvelua ei ole määritetty', 500);

  const body = await getJsonBody(request);
  const name = (body?.name || '').toString().trim();
  const email = (body?.email || '').toString().trim();

  if (name.length < 2 || name.length > 100) return errorResponse('Anna nimesi', 400);
  if (!validEmail(email)) return errorResponse('Anna kelvollinen sähköpostiosoite', 400);

  const sent = new Date().toISOString();
  const text =
`Nimi: ${name}
Sähköposti: ${email}
Lähetetty: ${sent}

Luo käyttäjätili: https://www.photoandmoto.fi/fi/yllapito`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [EDITOR_INBOX],
        reply_to: email,
        subject: 'Uusi käyttöoikeuspyyntö — Yleinen Kynä',
        text,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('Resend error (request-access):', res.status, t);
      return errorResponse('Pyynnön lähetys epäonnistui — yritä myöhemmin uudelleen', 502);
    }
  } catch (e) {
    console.error('request-access threw:', e);
    return errorResponse('Pyynnön lähetys epäonnistui — yritä myöhemmin uudelleen', 502);
  }

  return jsonResponse({ ok: true });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
