// functions/api/submissions.js
//
// Hyväksynnät (Phase 3 editorial board). Both endpoints require the
// `hallitse_artikkeleita` permission.
//
//   GET  /api/submissions   → all submissions, newest first
//   POST /api/submissions   → { id, action: 'julkaistu' | 'hylatty', rejection_reason? }
//        'hylatty' requires rejection_reason and emails the author (non-fatal).

import {
  requireAuth, getJsonBody, jsonResponse, errorResponse, corsOptionsResponse,
} from '../_lib/auth.js';

const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, 'hallitse_artikkeleita');
  if (auth.error) return errorResponse(auth.error, auth.status);
  if (!env.DB) return errorResponse('Tietokantaa ei ole määritetty', 500);

  const { results } = await env.DB.prepare(
    `SELECT id, type, status, title, author_id, author_name, author_email,
            category, github_slug, submitted_at, reviewed_at, reviewed_by, rejection_reason
     FROM submissions
     ORDER BY submitted_at DESC`
  ).all();

  return jsonResponse({ submissions: results || [] });
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

  if (!id || Number.isNaN(id)) return errorResponse('Virheellinen lähetyksen ID', 400);
  if (action !== 'julkaistu' && action !== 'hylatty') return errorResponse('Virheellinen toiminto', 400);
  if (action === 'hylatty' && !rejectionReason) return errorResponse('Hylkäyksen syy vaaditaan', 400);
  if (rejectionReason.length > 500) return errorResponse('Syy on liian pitkä (enintään 500 merkkiä)', 400);

  const row = await env.DB.prepare(
    `SELECT id, type, status, title, author_name, author_email FROM submissions WHERE id = ?`
  ).bind(id).first();
  if (!row) return errorResponse('Lähetystä ei löytynyt', 404);

  await env.DB.prepare(
    `UPDATE submissions
     SET status = ?, reviewed_at = datetime('now'), reviewed_by = ?, rejection_reason = ?
     WHERE id = ?`
  ).bind(action, auth.user.id, action === 'hylatty' ? rejectionReason : null, id).run();

  // On rejection, email the author (non-fatal — the status is already saved).
  let emailWarning = null;
  if (action === 'hylatty') {
    const typeLabel = row.type === 'pikauutinen' ? 'pikauutinen' : 'artikkeli';
    if (env.RESEND_API_KEY && row.author_email) {
      const isProd = env.CF_PAGES_BRANCH === 'main';
      const baseUrl = isProd ? 'https://www.photoandmoto.fi' : 'https://photoandmoto-staging.pages.dev';
      const text =
`Hei ${row.author_name || ''},

Kiitos lähetyksestäsi Photo & Moto -sivustolle. Valitettavasti lähettämääsi
${typeLabel}a ei tällä kertaa julkaistu.

Otsikko: ${row.title}
Syy: ${rejectionReason}

Voit muokata sisältöä annetun palautteen pohjalta ja lähettää sen uudelleen:
${baseUrl}/fi/yleinen-kyna

Kiitos panoksestasi — toivomme näkevämme uuden version!

Ystävällisin terveisin,
Photo & Moto -toimitus`;
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM,
            to: [row.author_email],
            subject: `Lähettämäsi ${typeLabel} ei mennyt läpi — Photo & Moto`,
            text,
          }),
        });
        if (!res.ok) { emailWarning = 'Hylkäysviestin lähetys epäonnistui'; console.error('Resend error (reject):', res.status, await res.text().catch(() => '')); }
      } catch (e) {
        emailWarning = 'Hylkäysviestin lähetys epäonnistui';
        console.error('reject email threw:', e);
      }
    } else if (!row.author_email) {
      emailWarning = 'Lähettäjän sähköpostia ei tiedossa — viestiä ei lähetetty';
    } else {
      emailWarning = 'RESEND_API_KEY puuttuu — viestiä ei lähetetty';
    }
  }

  return jsonResponse({ success: true, id, status: action, email_warning: emailWarning });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
