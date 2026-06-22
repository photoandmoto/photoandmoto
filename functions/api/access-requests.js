// functions/api/access-requests.js
//
// Hyväksynnät — verified Avustaja access requests. Both endpoints require the
// `hallitse_artikkeleita` permission.
//
//   GET  /api/access-requests   → verified, not-yet-handled requests, newest first
//   POST /api/access-requests   → { id, action: 'handled' | 'rejected', rejection_reason? }
//        'rejected' requires rejection_reason and emails the requester (non-fatal).
//        Both mark the request handled so it drops off the list.

import {
  requireAuth, getJsonBody, jsonResponse, errorResponse, corsOptionsResponse,
} from '../_lib/auth.js';

const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, 'hallitse_artikkeleita');
  if (auth.error) return errorResponse(auth.error, auth.status);
  if (!env.DB) return errorResponse('Tietokantaa ei ole määritetty', 500);

  const { results } = await env.DB.prepare(
    `SELECT id, name, email, reason, created_at
     FROM access_requests
     WHERE verified = 1 AND COALESCE(handled, 0) = 0
     ORDER BY created_at DESC`
  ).all();

  return jsonResponse({ requests: results || [] });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, 'hallitse_artikkeleita');
  if (auth.error) return errorResponse(auth.error, auth.status);
  if (!env.DB) return errorResponse('Tietokantaa ei ole määritetty', 500);

  const body = await getJsonBody(request);
  if (!body) return errorResponse('Virheellinen pyyntö', 400);

  const id = Number(body.id);
  const action = body.action;
  const rejectionReason = (body.rejection_reason || '').toString().trim();

  if (!id || Number.isNaN(id)) return errorResponse('Virheellinen pyynnön ID', 400);
  if (action !== 'handled' && action !== 'rejected') return errorResponse('Virheellinen toiminto', 400);
  if (action === 'rejected' && !rejectionReason) return errorResponse('Hylkäyksen syy vaaditaan', 400);
  if (rejectionReason.length > 500) return errorResponse('Syy on liian pitkä (enintään 500 merkkiä)', 400);

  const row = await env.DB.prepare(
    `SELECT id, name, email FROM access_requests WHERE id = ?`
  ).bind(id).first();
  if (!row) return errorResponse('Pyyntöä ei löytynyt', 404);

  await env.DB.prepare(
    `UPDATE access_requests
     SET handled = 1, handled_at = datetime('now'), rejection_reason = ?
     WHERE id = ?`
  ).bind(action === 'rejected' ? rejectionReason : null, id).run();

  // On rejection, email the requester (non-fatal — already marked handled).
  let emailWarning = null;
  if (action === 'rejected') {
    if (env.RESEND_API_KEY && row.email) {
      const text =
`Hei ${row.name || ''},

Kiitos kiinnostuksestasi kirjoittaa Photo & Moto -sivustolle. Valitettavasti
käyttöoikeuspyyntöäsi ei tällä kertaa hyväksytty.

Syy: ${rejectionReason}

Voit halutessasi lähettää uuden pyynnön myöhemmin osoitteessa
photoandmoto.fi/fi/toimitus.

Ystävällisin terveisin,
Photo & Moto -toimitus`;
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM,
            to: [row.email],
            subject: 'Käyttöoikeuspyyntösi ei mennyt läpi — Photo & Moto',
            text,
          }),
        });
        if (!res.ok) { emailWarning = 'Hylkäysviestin lähetys epäonnistui'; console.error('Resend error (access reject):', res.status, await res.text().catch(() => '')); }
      } catch (e) {
        emailWarning = 'Hylkäysviestin lähetys epäonnistui';
        console.error('access reject email threw:', e);
      }
    } else if (!row.email) {
      emailWarning = 'Sähköpostia ei tiedossa — viestiä ei lähetetty';
    } else {
      emailWarning = 'RESEND_API_KEY puuttuu — viestiä ei lähetetty';
    }
  }

  return jsonResponse({ success: true, id, action, email_warning: emailWarning });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
