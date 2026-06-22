// functions/api/submissions/sweep.js
//
// Hyväksynnät auto-detection sweep. Requires the `hallitse_artikkeleita`
// permission. Called by the "Julkaise" tab BEFORE a staging/production deploy
// is triggered, so submission statuses reflect what the editor actually did in
// Sveltia (approved by un-hiding, or rejected by deleting the draft).
//
//   POST /api/submissions/sweep   → { ok, swept, approved, rejected }
//
// For every D1 submission still 'odottaa':
//   • draft .md missing from the dev branch (404) → editor deleted it in
//     Sveltia → mark 'hylatty' + email the author a generic rejection.
//   • draft .md present and no longer a draft (draft: false / "Näytä
//     sivustoilla") → editor approved it → mark 'julkaistu' + email the author.
//   • draft .md present and still draft: true → leave 'odottaa', do nothing.
//
// All GitHub reads, D1 writes, and emails are best-effort: a failure on one
// submission is logged and skipped so the rest of the sweep (and the deploy
// that follows) still proceeds.

import {
  requireAuth, jsonResponse, errorResponse, corsOptionsResponse,
} from '../../_lib/auth.js';

const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';
const REPO_OWNER = 'photoandmoto';
const REPO_NAME = 'photoandmoto';

// ---------------------------------------------------------------------------
// GitHub App auth helpers (same pattern as submissions.js / approve.js).
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

// Read the frontmatter `draft:` flag. Returns true only when the first
// frontmatter block has an explicit `draft: true`. Anything else (draft: false,
// or no draft field — which the Zod schema treats as false) counts as visible.
function isDraftHidden(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return false;
  const dm = m[1].match(/^draft:[ \t]*(\S+)/m);
  if (!dm) return false;
  return dm[1].toLowerCase() === 'true';
}

// ---------------------------------------------------------------------------
// Author emails (best-effort). Mirror the wording used in approve.js /
// submissions.js so the contributor gets a consistent voice.
// ---------------------------------------------------------------------------
async function sendApprovalEmail(env, row, baseUrl) {
  if (!env.RESEND_API_KEY || !row.author_email) return;
  const typeLabel = row.type === 'pikauutinen' ? 'pikauutisesi' : 'artikkelisi';
  const text =
`Hei ${row.author_name || ''},

Hienoa työtä! Lähettämäsi ${typeLabel} on hyväksytty ja julkaistaan Photo & Moto
-sivustolle.

Otsikko: ${row.title}

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
    if (!res.ok) console.error('sweep approval email failed:', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.error('sweep approval email threw:', e);
  }
}

async function sendRejectionEmail(env, row) {
  if (!env.RESEND_API_KEY || !row.author_email) return;
  const typeLabel = row.type === 'pikauutinen' ? 'pikauutinen' : 'artikkeli';
  const isProd = env.CF_PAGES_BRANCH === 'main';
  const baseUrl = isProd ? 'https://www.photoandmoto.fi' : 'https://photoandmoto-staging.pages.dev';
  const text =
`Hei ${row.author_name || ''},

Kiitos lähetyksestäsi Photo & Moto -sivustolle. Valitettavasti lähettämääsi
${typeLabel}a ei tällä kertaa julkaistu.

Otsikko: ${row.title}

Emme valitettavasti voi julkaista kaikkea lähetettyä sisältöä. Jos haluat
lisätietoja tai palautetta, ota yhteyttä toimitukseen. Voit myös muokata
sisältöä ja lähettää sen uudelleen:
${baseUrl}/fi/yleinen-kyna

Kiitos panoksestasi — toivomme näkevämme sinusta lisää!

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
    if (!res.ok) console.error('sweep rejection email failed:', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.error('sweep rejection email threw:', e);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env, 'hallitse_artikkeleita');
  if (auth.error) return errorResponse(auth.error, auth.status);
  if (!env.DB) return errorResponse('Tietokantaa ei ole määritetty', 500);
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return errorResponse('GitHub App -asetukset puuttuvat', 500);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, type, status, title, author_name, author_email, github_slug
     FROM submissions WHERE status = 'odottaa'`
  ).all();
  const pending = results || [];
  if (!pending.length) return jsonResponse({ ok: true, swept: 0, approved: 0, rejected: 0 });

  const branch = targetBranch(env);
  const isProd = env.CF_PAGES_BRANCH === 'main';
  const baseUrl = isProd ? 'https://www.photoandmoto.fi' : 'https://photoandmoto-staging.pages.dev';

  let token;
  try {
    const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
    token = await getInstallationToken(jwt, env.GITHUB_APP_INSTALLATION_ID);
  } catch (e) {
    console.error('sweep: GitHub auth failed:', e);
    return errorResponse('GitHub-todennus epäonnistui', 502);
  }
  const ghHeaders = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'photoandmoto-publisher' };

  let approved = 0, rejected = 0;
  for (const row of pending) {
    // Skip rows we can't locate a file for — nothing to detect.
    if (!row.github_slug) { console.warn('sweep: submission has no github_slug, skipping', row.id); continue; }
    const dir = row.type === 'pikauutinen' ? 'src/content/pikauutiset' : 'src/content/articles/fi';
    const path = `${dir}/${row.github_slug}.md`;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');

    try {
      const getRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });

      if (getRes.status === 404) {
        // Draft was deleted in Sveltia → reject.
        await env.DB.prepare(
          `UPDATE submissions
           SET status = 'hylatty', reviewed_at = datetime('now'), reviewed_by = ?, rejection_reason = ?
           WHERE id = ?`
        ).bind(auth.user.id, 'Luonnos poistettu Sveltiassa (automaattinen hylkäys)', row.id).run();
        await sendRejectionEmail(env, row);
        rejected++;
        continue;
      }

      if (!getRes.ok) { console.error('sweep: contents GET failed', row.id, getRes.status, await getRes.text().catch(() => '')); continue; }

      const fileJson = await getRes.json();
      const md = base64Utf8Decode(fileJson.content || '');
      if (isDraftHidden(md)) continue; // still hidden → leave 'odottaa'

      // No longer a draft → approve.
      await env.DB.prepare(
        `UPDATE submissions
         SET status = 'julkaistu', reviewed_at = datetime('now'), reviewed_by = ?, rejection_reason = NULL
         WHERE id = ?`
      ).bind(auth.user.id, row.id).run();
      await sendApprovalEmail(env, row, baseUrl);
      approved++;
    } catch (e) {
      console.error('sweep: row failed (non-fatal)', row.id, e);
    }
  }

  return jsonResponse({ ok: true, swept: pending.length, approved, rejected });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
