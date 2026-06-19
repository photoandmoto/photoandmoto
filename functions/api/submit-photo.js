// functions/api/submit-photo.js
//
// Avustaja "Lähetä kuva" — a logged-in contributor submits a single photo for
// the Tarkista (mystery identification) queue WITH an explicit ownership/consent
// declaration that is recorded in a permanent audit trail (photo_submissions).
//
// This is deliberately a SEPARATE flow from the editor upload (/api/mystery/upload):
//   • editor uploads stay trusted/simple — no consent, no audit row
//   • avustaja uploads require consent + create a photo_submissions audit record
// Both feed the SAME photos table, so the photo lands in the Tarkista queue
// exactly like an editor upload (do not break existing functionality).
//
// Auth: session cookie with perm_laheta_artikkeli OR perm_lahetakuva.

import { requireAuth } from '../_lib/auth.js';
import { runInit } from './auth/init.js';
import { PHOTO_CONSENT_TEXT } from '../_lib/consent.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ error: 'Tietokantaa ei ole määritetty' }, 500);

    // Auth — accept either the Avustaja submit permission or the editor upload
    // permission. requireAuth enforces one flag, so check both manually.
    const auth = await requireAuth(request, env);
    if (auth.error) return json({ error: auth.error }, auth.status);
    const perms = auth.user.permissions || {};
    if (!perms.laheta_artikkeli && !perms.lahetakuva) {
      return json({ error: 'Ei oikeutta tähän toimintoon' }, 403);
    }

    let fd;
    try { fd = await request.formData(); } catch { return json({ error: 'Virheellinen lomakedata' }, 400); }

    // Consent — defense in depth: never trust the frontend's disabled button.
    const consent = fd.get('consent_given');
    const consentGiven = consent === '1' || consent === 'true' || consent === 'on';
    if (!consentGiven) {
      return json({ error: 'Suostumus kuvan julkaisuun vaaditaan.' }, 400);
    }

    const file = fd.get('photo');
    if (!file || typeof file === 'string' || !file.size) {
      return json({ error: 'Kuvaa ei löytynyt' }, 400);
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return json({ error: 'Sallitut: JPEG, PNG, WEBP' }, 400);
    }
    if (file.size > 5 * 1024 * 1024) {
      return json({ error: 'Max 5 MB' }, 400);
    }

    // Ensure the audit table exists (idempotent) — guarantees the feature works
    // on first use without a manual /api/auth/init re-run after deploy.
    try { await runInit(env); } catch (e) { console.error('submit-photo runInit failed:', e); }

    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    const imageB64 = btoa(bin);

    // The image is stored as base64 in D1 (photos.image_data) exactly like the
    // editor flow. D1 caps a single value at ~2,000,000 bytes, so reject an
    // oversized payload with a friendly message instead of a raw D1_ERROR. The
    // Avustaja client downsizes to 1600px/q0.8 first, so this should be rare.
    if (imageB64.length > 1_900_000) {
      return json({ error: 'Kuva on liian suuri tallennettavaksi. Yritä pienemmällä tai pienempiresoluutioisella kuvalla.' }, 413);
    }

    // Optional client-generated thumbnail (same contract as /api/mystery/upload).
    let thumbData = fd.get('thumb_data');
    if (thumbData && typeof thumbData === 'string' && thumbData.length > 100 * 1024) thumbData = null;
    if (!thumbData) thumbData = null;

    const submitterName = `${auth.user.first_name || ''} ${auth.user.last_name || ''}`.trim() || 'Avustaja';
    const submitterEmail = auth.user.email || '';

    // 1. Insert into photos so it enters the Tarkista queue (mirrors upload.js).
    const photoRes = await env.DB.prepare(
      `INSERT INTO photos (filename,content_type,image_data,uploader_name,year_estimate,people,location_notes,notes,thumb_data)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      file.name,
      file.type,
      imageB64,
      submitterName,
      fd.get('year_estimate') || '',
      fd.get('people') || '',
      fd.get('location_notes') || '',
      fd.get('notes') || '',
      thumbData
    ).run();
    const photoId = photoRes.meta.last_row_id;

    // 2. Record the permanent consent/audit row, linked to the photo.
    await env.DB.prepare(
      `INSERT INTO photo_submissions
         (photo_id, filename, submitter_name, submitter_email, submitter_id,
          consent_given, consent_text, consent_at, status)
       VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), 'odottaa')`
    ).bind(
      photoId,
      file.name,
      submitterName,
      submitterEmail,
      auth.user.id,
      PHOTO_CONSENT_TEXT
    ).run();

    return json({ ok: true, id: photoId });
  } catch (err) {
    console.error('submit-photo error:', err);
    return json({ error: err.message || 'Palvelinvirhe' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
