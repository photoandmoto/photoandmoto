// functions/api/photo-submissions.js
//
// Avustaja photo submissions (audit trail) — read + reject surface.
//
//   GET  /api/photo-submissions   → pending ('odottaa') submissions, newest first.
//        Used by (a) the Hyväksynnät "Kuvat" sub-section and (b) the Tarkista
//        view, which maps photo_id → submitter to show a tag + Hylkää button on
//        avustaja-submitted photos. Requires perm_tarkista OR
//        perm_hallitse_artikkeleita.
//
//   POST /api/photo-submissions   → { photo_id, action: 'hylatty', rejection_reason }
//        Reject an avustaja photo: mark the audit row 'hylatty', email the
//        submitter (non-fatal), and delete the photo from the Tarkista queue.
//        Approval is handled in /api/mystery/publish (assign-to-gallery).
//        Requires perm_tarkista.

import {
  requireAuth, getJsonBody, jsonResponse, errorResponse, corsOptionsResponse,
} from '../_lib/auth.js';

const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);
  if (auth.error) return errorResponse(auth.error, auth.status);
  const perms = auth.user.permissions || {};
  if (!perms.tarkista && !perms.hallitse_artikkeleita) {
    return errorResponse('Ei oikeutta tähän toimintoon', 403);
  }
  if (!env.DB) return errorResponse('Tietokantaa ei ole määritetty', 500);

  // Defensive: the table may not exist yet on a DB where init hasn't been
  // re-run since this feature shipped. Treat that as "no submissions".
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, photo_id, filename, submitter_name, submitter_email,
              consent_given, submitted_at
       FROM photo_submissions
       WHERE status = 'odottaa'
       ORDER BY submitted_at DESC`
    ).all();
    return jsonResponse({ submissions: results || [] });
  } catch (e) {
    console.error('photo-submissions GET (non-fatal):', e?.message || e);
    return jsonResponse({ submissions: [] });
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, 'tarkista');
  if (auth.error) return errorResponse(auth.error, auth.status);
  if (!env.DB) return errorResponse('Tietokantaa ei ole määritetty', 500);

  const body = await getJsonBody(request);
  if (!body) return errorResponse('Virheellinen pyyntö', 400);

  const photoId = Number(body.photo_id);
  const action = body.action;
  const rejectionReason = (body.rejection_reason || '').toString().trim();

  if (!photoId || Number.isNaN(photoId)) return errorResponse('Virheellinen kuvan ID', 400);
  if (action !== 'hylatty') return errorResponse('Virheellinen toiminto', 400);
  if (!rejectionReason) return errorResponse('Hylkäyksen syy vaaditaan', 400);
  if (rejectionReason.length > 500) return errorResponse('Syy on liian pitkä (enintään 500 merkkiä)', 400);

  const row = await env.DB.prepare(
    `SELECT id, submitter_name, submitter_email, filename
     FROM photo_submissions
     WHERE photo_id = ? AND status = 'odottaa'`
  ).bind(photoId).first();
  if (!row) return errorResponse('Lähetystä ei löytynyt', 404);

  // 1. Mark the audit row rejected (permanent — never deleted).
  await env.DB.prepare(
    `UPDATE photo_submissions
     SET status = 'hylatty', rejection_reason = ?, reviewed_at = datetime('now'), reviewed_by = ?
     WHERE id = ?`
  ).bind(rejectionReason, auth.user.id, row.id).run();

  // 2. Remove the photo from the Tarkista queue (the audit row stays).
  try {
    await env.DB.prepare(`DELETE FROM comments WHERE photo_id = ?`).bind(photoId).run();
    await env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(photoId).run();
  } catch (e) {
    console.error('photo reject: queue cleanup failed (non-fatal):', e);
  }

  // 3. Email the submitter (non-fatal — the rejection is already saved).
  let emailWarning = null;
  if (env.RESEND_API_KEY && row.submitter_email) {
    const text =
`Hei ${row.submitter_name || ''},

Kiitos lähettämästäsi kuvasta Photo & Moto -sivustolle. Valitettavasti kuvaa ei
tällä kertaa julkaistu.

Syy: ${rejectionReason}

Voit halutessasi lähettää uuden kuvan myöhemmin. Kiitos panoksestasi!

Ystävällisin terveisin,
Photo & Moto -toimitus`;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [row.submitter_email],
          subject: 'Lähettämäsi kuva ei mennyt läpi — Photo & Moto',
          text,
        }),
      });
      if (!res.ok) { emailWarning = 'Hylkäysviestin lähetys epäonnistui'; console.error('Resend error (photo reject):', res.status, await res.text().catch(() => '')); }
    } catch (e) {
      emailWarning = 'Hylkäysviestin lähetys epäonnistui';
      console.error('photo reject email threw:', e);
    }
  } else if (!row.submitter_email) {
    emailWarning = 'Lähettäjän sähköpostia ei tiedossa — viestiä ei lähetetty';
  } else {
    emailWarning = 'RESEND_API_KEY puuttuu — viestiä ei lähetetty';
  }

  return jsonResponse({ success: true, photo_id: photoId, status: 'hylatty', email_warning: emailWarning });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
