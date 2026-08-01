// functions/api/submissions.js
//
// Hyväksynnät (Phase 3 editorial board). Both endpoints require the
// `hallitse_artikkeleita` permission.
//
//   GET  /api/submissions   → all submissions, newest first
//   POST /api/submissions   → { id, action: 'hylatty', rejection_reason }
//        Reject only — requires rejection_reason, deletes the draft .md, and
//        emails the author (both non-fatal). Approval is auto-detected by the
//        Julkaise sweep (POST /api/submissions/sweep) — there is no manual
//        approve endpoint.

import {
  requireAuth, getJsonBody, jsonResponse, errorResponse, corsOptionsResponse,
} from '../_lib/auth.js';

const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';
const REPO_OWNER = 'photoandmoto';
const REPO_NAME = 'photoandmoto';

// ---------------------------------------------------------------------------
// GitHub App auth helpers (same pattern as submit-article.js) — used to delete
// the draft .md when a submission is rejected.
// ---------------------------------------------------------------------------
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(out);
}
function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function utf8ToBase64Url(str) { return bytesToBase64Url(new TextEncoder().encode(str)); }

async function importPrivateKey(pemString) {
  const pem = pemString
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const der = base64ToBytes(pem);
  try {
    return await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    const pkcs8Header = new Uint8Array([
      0x30, 0x82, 0x00, 0x00, 0x02, 0x01, 0x00, 0x30, 0x0d,
      0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
      0x05, 0x00, 0x04, 0x82, 0x00, 0x00,
    ]);
    const totalLen = pkcs8Header.length + der.length;
    pkcs8Header[2] = ((totalLen - 4) >> 8) & 0xff;
    pkcs8Header[3] = (totalLen - 4) & 0xff;
    pkcs8Header[pkcs8Header.length - 2] = (der.length >> 8) & 0xff;
    pkcs8Header[pkcs8Header.length - 1] = der.length & 0xff;
    const wrapped = new Uint8Array(totalLen);
    wrapped.set(pkcs8Header, 0);
    wrapped.set(der, pkcs8Header.length);
    return await crypto.subtle.importKey('pkcs8', wrapped, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
}
async function signAppJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 8 * 60, iss: String(appId) };
  const signingInput = `${utf8ToBase64Url(JSON.stringify(header))}.${utf8ToBase64Url(JSON.stringify(payload))}`;
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`;
}
async function getInstallationToken(appJwt, installationId) {
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${appJwt}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'photoandmoto-publisher' },
  });
  if (!res.ok) throw new Error(`Installation token request failed (${res.status}): ${await res.text()}`);
  return (await res.json()).token;
}
function targetBranch(env) {
  return (env.CF_PAGES_BRANCH || env.CF_PAGES_TARGET_BRANCH || '') === 'main' ? 'main' : 'dev';
}

// Delete a rejected submission's draft .md from the target branch via the
// GitHub Contents API. Fully non-fatal: missing slug, missing file, missing
// App config, or any API error is logged and swallowed.
async function deleteRejectedDraft(env, type, slug) {
  if (!slug) { console.warn('reject delete skipped: no github_slug'); return; }
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    console.warn('reject delete skipped: GitHub App not configured'); return;
  }
  const dir = type === 'pikauutinen' ? 'src/content/pikauutiset' : 'src/content/articles/fi';
  const path = `${dir}/${slug}.md`;
  const branch = targetBranch(env);
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  try {
    const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
    const token = await getInstallationToken(jwt, env.GITHUB_APP_INSTALLATION_ID);
    const ghHeaders = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'photoandmoto-publisher' };

    // 1. Get the file SHA.
    const getRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });
    if (getRes.status === 404) { console.warn('reject delete: file not found', path); return; }
    if (!getRes.ok) { console.error('reject delete: contents GET failed', getRes.status, await getRes.text().catch(() => '')); return; }
    const fileSha = (await getRes.json()).sha;

    // 2. Delete it.
    const delRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodedPath}`, {
      method: 'DELETE',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      // Prefix MUST stay "chore: reject submission" — auto-promote-deletions.yml
      // matches it to SKIP promoting dev → main for rejection deletions.
      body: JSON.stringify({ message: `chore: reject submission — ${slug}`, sha: fileSha, branch }),
    });
    if (!delRes.ok) console.error('reject delete: DELETE failed', delRes.status, await delRes.text().catch(() => ''));
  } catch (e) {
    console.error('reject delete threw (non-fatal):', e);
  }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, 'hallitse_artikkeleita');
  if (auth.error) return errorResponse(auth.error, auth.status);
  if (!env.DB) return errorResponse('Tietokantaa ei ole määritetty', 500);

  const { results } = await env.DB.prepare(
    `SELECT id, type, status, title, author_id, author_name, author_email,
            category, github_slug, submitted_at, reviewed_at, reviewed_by, rejection_reason,
            published_as
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
  // Approval is auto-detected by the Julkaise sweep — this endpoint only rejects.
  if (action !== 'hylatty') return errorResponse('Virheellinen toiminto', 400);
  if (!rejectionReason) return errorResponse('Hylkäyksen syy vaaditaan', 400);
  if (rejectionReason.length > 500) return errorResponse('Syy on liian pitkä (enintään 500 merkkiä)', 400);

  const row = await env.DB.prepare(
    `SELECT id, type, status, title, author_name, author_email, github_slug FROM submissions WHERE id = ?`
  ).bind(id).first();
  if (!row) return errorResponse('Lähetystä ei löytynyt', 404);

  await env.DB.prepare(
    `UPDATE submissions
     SET status = 'hylatty', reviewed_at = datetime('now'), reviewed_by = ?, rejection_reason = ?
     WHERE id = ?`
  ).bind(auth.user.id, rejectionReason, id).run();

  // Delete the draft .md from the repo (non-fatal, independent of the email and
  // the D1 update which have already completed).
  await deleteRejectedDraft(env, row.type, row.github_slug);

  // Email the author (non-fatal — the status is already saved).
  let emailWarning = null;
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

  return jsonResponse({ success: true, id, status: 'hylatty', email_warning: emailWarning });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
