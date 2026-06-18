// functions/api/submissions/approve.js
//
// Hyväksynnät — "Hyväksy ja julkaise" (approve & publish). Requires the
// `hallitse_artikkeleita` permission.
//
//   POST /api/submissions/approve   → { id }
//
// Flow: read the submission's draft .md from the target branch, flip
// `draft: true` → `draft: false`, commit it back via the Photoandmoto
// Publisher GitHub App, mark the D1 submission 'julkaistu', and email the
// author (non-fatal). The change still needs a manual "Julkaise tuotantoon"
// to reach production — the UI reminds the editor of this.

import {
  requireAuth, getJsonBody, jsonResponse, errorResponse, corsOptionsResponse,
} from '../../_lib/auth.js';

const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';
const REPO_OWNER = 'photoandmoto';
const REPO_NAME = 'photoandmoto';

// ---------------------------------------------------------------------------
// GitHub App auth helpers (same pattern as submit-article.js / submissions.js).
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
function utf8ToBase64(str) { return bytesToBase64(new TextEncoder().encode(str)); }
function utf8ToBase64Url(str) { return bytesToBase64Url(new TextEncoder().encode(str)); }
function base64Utf8Decode(b64) {
  // GitHub's Contents API returns base64 with embedded newlines — strip them.
  return new TextDecoder().decode(base64ToBytes(b64.replace(/\s/g, '')));
}

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

// Flip the frontmatter `draft:` field to false. Operates only on the first
// frontmatter block (between the leading `---` and the next `---`) so body
// content is never touched. Returns the original string unchanged if there is
// no frontmatter. Reconstructs by slicing (not String.replace) so `$`-bearing
// body text can't corrupt the output.
function setDraftFalse(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return md;
  let fm = m[1];
  if (/^draft:[ \t]*.*$/m.test(fm)) {
    fm = fm.replace(/^draft:[ \t]*.*$/m, 'draft: false');
  } else {
    fm = `${fm}\ndraft: false`;
  }
  return `${md.slice(0, m.index)}---\n${fm}\n---${md.slice(m.index + m[0].length)}`;
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, 'hallitse_artikkeleita');
  if (auth.error) return errorResponse(auth.error, auth.status);
  if (!env.DB) return errorResponse('Tietokantaa ei ole määritetty', 500);

  const body = await getJsonBody(request);
  if (!body) return errorResponse('Virheellinen pyyntö', 400);

  const id = Number(body.id);
  if (!id || Number.isNaN(id)) return errorResponse('Virheellinen lähetyksen ID', 400);

  const row = await env.DB.prepare(
    `SELECT id, type, status, title, author_name, author_email, github_slug FROM submissions WHERE id = ?`
  ).bind(id).first();
  if (!row) return errorResponse('Lähetystä ei löytynyt', 404);

  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return errorResponse('GitHub App -asetukset puuttuvat', 500);
  }
  if (!row.github_slug) return errorResponse('Lähetykseltä puuttuu tiedoston tunniste', 400);

  const dir = row.type === 'pikauutinen' ? 'src/content/pikauutiset' : 'src/content/articles/fi';
  const path = `${dir}/${row.github_slug}.md`;
  const branch = targetBranch(env);
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');

  // 1. Read the draft, flip draft:false, and commit it back via the App.
  try {
    const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
    const token = await getInstallationToken(jwt, env.GITHUB_APP_INSTALLATION_ID);
    const ghHeaders = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'photoandmoto-publisher' };

    const getRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });
    if (getRes.status === 404) return errorResponse('Artikkelitiedostoa ei löytynyt GitHubista', 404);
    if (!getRes.ok) { console.error('approve: contents GET failed', getRes.status, await getRes.text().catch(() => '')); return errorResponse('GitHub-haku epäonnistui', 502); }
    const fileJson = await getRes.json();
    const original = base64Utf8Decode(fileJson.content || '');
    const updated = setDraftFalse(original);

    // Only commit when something actually changed (idempotent re-approve).
    if (updated !== original) {
      const putRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodedPath}`, {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `feat: approve submission — ${row.github_slug}`,
          content: utf8ToBase64(updated),
          sha: fileJson.sha,
          branch,
        }),
      });
      if (!putRes.ok) { console.error('approve: PUT failed', putRes.status, await putRes.text().catch(() => '')); return errorResponse('Artikkelin päivitys epäonnistui', 502); }
    }
  } catch (e) {
    console.error('approve commit threw:', e);
    return errorResponse('GitHub-toiminto epäonnistui', 502);
  }

  // 2. Mark approved in D1.
  await env.DB.prepare(
    `UPDATE submissions
     SET status = 'julkaistu', reviewed_at = datetime('now'), reviewed_by = ?, rejection_reason = NULL
     WHERE id = ?`
  ).bind(auth.user.id, id).run();

  // 3. Email the author (non-fatal — the approval is already committed + saved).
  let emailWarning = null;
  const typeLabel = row.type === 'pikauutinen' ? 'pikauutisesi' : 'artikkelisi';
  if (env.RESEND_API_KEY && row.author_email) {
    const isProd = env.CF_PAGES_BRANCH === 'main';
    const baseUrl = isProd ? 'https://www.photoandmoto.fi' : 'https://photoandmoto-staging.pages.dev';
    const text =
`Hei ${row.author_name || ''},

Hienoa työtä! Lähettämäsi ${typeLabel} on hyväksytty julkaistavaksi Photo & Moto
-sivustolle.

Otsikko: ${row.title}

Sisältö tulee näkyviin sivustolle, kun toimitus julkaisee seuraavat muutokset.
Voit käydä katsomassa sivustoa osoitteessa:
${baseUrl}/fi

Kiitos arvokkaasta panoksestasi — pidetään yhteyttä!

Ystävällisin terveisin,
Photo & Moto -toimitus`;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [row.author_email],
          subject: 'Artikkelisi on hyväksytty — Photo & Moto',
          text,
        }),
      });
      if (!res.ok) { emailWarning = 'Hyväksyntäviestin lähetys epäonnistui'; console.error('Resend error (approve):', res.status, await res.text().catch(() => '')); }
    } catch (e) {
      emailWarning = 'Hyväksyntäviestin lähetys epäonnistui';
      console.error('approve email threw:', e);
    }
  } else if (!row.author_email) {
    emailWarning = 'Lähettäjän sähköpostia ei tiedossa — viestiä ei lähetetty';
  } else {
    emailWarning = 'RESEND_API_KEY puuttuu — viestiä ei lähetetty';
  }

  return jsonResponse({ success: true, id, status: 'julkaistu', email_warning: emailWarning });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
