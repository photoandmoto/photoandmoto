// GET /api/verify-access-request?token=xxx
//
// Avustaja access-request flow — step 2 of 2. The requestor clicks the link in
// their verification email. We mark the request verified and notify the editor.
// Idempotent: a second click returns "already verified" without re-notifying.

import { jsonResponse, errorResponse, corsOptionsResponse } from '../_lib/auth.js';

const EDITOR_INBOX = 'photoandmoto@gmail.com';
const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';

export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorResponse('Tietokantaa ei ole määritetty', 500);

  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token) return errorResponse('Vahvistuslinkki on virheellinen', 400);

  const row = await env.DB.prepare(
    `SELECT id, name, email, reason, verified, created_at, expires_at
     FROM access_requests WHERE token = ?`
  ).bind(token).first();

  if (!row) return errorResponse('Linkki on virheellinen', 404);

  // Already verified → idempotent success, no re-notify.
  if (row.verified) return jsonResponse({ ok: true, already: true });

  // Expired?
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return errorResponse('Linkki on vanhentunut', 410);
  }

  await env.DB.prepare(`UPDATE access_requests SET verified = 1 WHERE id = ?`).bind(row.id).run();

  // Notify the editor (non-fatal — the request is already verified in D1).
  let emailWarning = false;
  if (env.RESEND_API_KEY) {
    const text =
`Nimi: ${row.name}
Sähköposti: ${row.email}
Syy: ${row.reason}
Lähetetty: ${new Date().toISOString()}

Luo käyttäjätili: https://www.photoandmoto.fi/fi/toimitus
(Kirjaudu → Toimitus → Käyttäjät → Luo uusi käyttäjä, valitse rooli Avustaja)`;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [EDITOR_INBOX],
          reply_to: row.email,
          subject: `Uusi Avustaja-käyttöoikeuspyyntö — ${row.name}`,
          text,
        }),
      });
      if (!res.ok) { emailWarning = true; console.error('Resend error (verify):', res.status, await res.text().catch(() => '')); }
    } catch (e) {
      emailWarning = true;
      console.error('verify-access-request email threw:', e);
    }
  } else {
    emailWarning = true;
  }

  return jsonResponse({ ok: true, already: false, email_warning: emailWarning });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
