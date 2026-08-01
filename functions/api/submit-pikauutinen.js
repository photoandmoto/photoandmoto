// POST /api/submit-pikauutinen
//
// Pikauutinen two-step flow — step 2: contributor submits the reviewed/edited draft.
// Performs GitHub commit, D1 audit record, and editor email notification.
// Step 1 (Gemini generation) is handled by /api/generate-article.

import { requireAuth } from '../_lib/auth.js';
import { CONSENT_PHOTO_TEXT, CONSENT_CONTENT_TEXT } from '../_lib/consent.js';

const REPO_OWNER = 'photoandmoto';
const REPO_NAME = 'photoandmoto';
const EDITOR_INBOX = 'photoandmoto@gmail.com';
const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TITLE_MAX = 80;
const BODY_MAX = 500;

const CATEGORY_LABELS = {
  Enduro: 'Enduro',
  Interview: 'Haastattelu',
  Profile: 'Henkilökuva',
  Historical: 'Historiallinen',
  'Ice speedway': 'Ice speedway',
  'Long Track': 'Maarata',
  Motocross: 'Motocross',
  MXGP: 'MXGP',
  Scramble: 'Scramble',
  Speedway: 'Speedway',
  Technical: 'Tekninen',
  Trail: 'Trail',
};
const ALLOWED_CATEGORIES = Object.keys(CATEGORY_LABELS);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const ok = (d) => json({ ok: true, ...d });
const fail = (msg, status = 400) => json({ ok: false, error: msg }, status);

// ---------------------------------------------------------------------------
// base64 / JWT helpers
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
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}
function utf8ToBase64(str) { return bytesToBase64(new TextEncoder().encode(str)); }
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
async function gh(token, path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'photoandmoto-publisher',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}
const getBranchHead = async (t, b) => (await gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${encodeURIComponent(b)}`)).object.sha;
const getCommit = (t, sha) => gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${sha}`);
const createBlob = (t, contentBase64) => gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: contentBase64, encoding: 'base64' }) });
const createTree = (t, baseTreeSha, tree) => gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseTreeSha, tree }) });
const createCommit = (t, message, treeSha, parentSha) => gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }) });
const updateBranch = (t, b, sha) => gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${encodeURIComponent(b)}`, { method: 'PATCH', body: JSON.stringify({ sha, force: false }) });

async function fileExists(token, branch, path) {
  const url = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(`https://api.github.com${url}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'photoandmoto-publisher' },
  });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`GitHub contents check failed (${res.status}): ${await res.text()}`);
}

function targetBranch(env) {
  return (env.CF_PAGES_BRANCH || env.CF_PAGES_TARGET_BRANCH || '') === 'main' ? 'main' : 'dev';
}

// ---------------------------------------------------------------------------
// Slug + filename sanitization
// ---------------------------------------------------------------------------
function foldNordic(s) {
  return s.replace(/[äà]/g, 'a').replace(/[öø]/g, 'o').replace(/å/g, 'a').replace(/[éè]/g, 'e').replace(/ü/g, 'u');
}
function slugify(title) {
  const s = foldNordic(String(title || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'pikauutinen';
}
function sanitizeImageName(name) {
  const dot = String(name || '').lastIndexOf('.');
  let base = dot > 0 ? name.slice(0, dot) : (name || 'kuva');
  let ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  base = foldNordic(base.toLowerCase())
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!base) base = 'kuva';
  if (!/^\.(jpe?g|png|webp)$/.test(ext)) ext = '.jpg';
  return base + ext;
}
function prepareImage(prefix, file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`Kuva on liian suuri (max 10 MB): ${file.name}`);
  const safe = `${prefix}-${sanitizeImageName(file.name)}`;
  return { repoPath: `public/images/${safe}`, publicPath: `/images/${safe}`, file };
}

function buildMarkdown(fm, body) {
  const L = [
    '---',
    `title: ${JSON.stringify(fm.title)}`,
    `date: ${fm.date}`,
    `author: ${JSON.stringify(fm.author)}`,
    `category: ${JSON.stringify(fm.category)}`,
    `photo: ${fm.photo ? JSON.stringify(fm.photo) : 'null'}`,
    'draft: true',
    'source: "ai_generated"',
    '---',
    '',
    body,
    '',
  ];
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuth(request, env, 'laheta_artikkeli');
    if (auth.error) return fail(auth.error, auth.status);

    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
      return fail('GitHub App -asetukset puuttuvat', 500);
    }

    let form;
    try { form = await request.formData(); } catch { return fail('Virheellinen lomakedata', 400); }

    const title = (form.get('title') || '').toString().trim();
    const body = (form.get('body') || '').toString().trim();
    const category = (form.get('category') || '').toString().trim();
    const date = (form.get('date') || '').toString().trim();
    const authorInput = (form.get('author') || '').toString().trim();
    const photo = form.get('photo');
    const hasPhoto = photo && typeof photo !== 'string' && photo.size > 0;

    const consentPhoto = (form.get('consent_photo') || '').toString().trim();
    const consentContent = (form.get('consent_content') || '').toString().trim();
    if (consentPhoto !== '1' || consentContent !== '1') {
      return fail('Sinun täytyy hyväksyä molemmat ehdot ennen lähettämistä.', 400);
    }

    if (!title) return fail('Otsikko on pakollinen', 400);
    if (title.length > TITLE_MAX) return fail(`Otsikko on liian pitkä (enintään ${TITLE_MAX} merkkiä)`, 400);
    if (!body) return fail('Teksti on pakollinen', 400);
    if (body.length > BODY_MAX) return fail(`Teksti on liian pitkä (enintään ${BODY_MAX} merkkiä)`, 400);
    if (!ALLOWED_CATEGORIES.includes(category)) return fail('Valitse kelvollinen kategoria', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Virheellinen päivämäärä', 400);

    // Byline is optional for the contributor: an empty field means "publish this
    // without my name", NOT "leave the field out". The frontmatter is always
    // written with a real value — an empty author would fail content-collection
    // validation and break the production build for everyone, including drafts
    // that Toimitus has not reviewed yet. Toimitus can still change it later in
    // Sveltia. Length-capped so a pasted essay can't end up in the byline.
    const sessionName = `${auth.user.first_name || ''} ${auth.user.last_name || ''}`.trim();
    const author = (authorInput || sessionName || 'Photo & Moto').slice(0, 80);
    const branch = targetBranch(env);

    let token;
    try {
      const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
      token = await getInstallationToken(jwt, env.GITHUB_APP_INSTALLATION_ID);
    } catch (e) {
      console.error('GitHub auth failed:', e);
      return fail('GitHub-todennus epäonnistui', 502);
    }

    let base = `${date}-${slugify(title)}`;
    let path = `src/content/pikauutiset/${base}.md`;
    try {
      if (await fileExists(token, branch, path)) {
        base = `${base}-${Date.now().toString(36).slice(-4)}`;
        path = `src/content/pikauutiset/${base}.md`;
      }
    } catch (e) {
      console.error('slug pre-flight failed:', e);
      return fail('GitHubin tarkistus epäonnistui', 502);
    }

    let photoPath = null, imageItem = null;
    if (hasPhoto) {
      try {
        imageItem = prepareImage(base, photo);
        photoPath = imageItem.publicPath;
      } catch (e) {
        console.error('photo prepare failed:', e);
        return fail(e.message || 'Kuvan käsittely epäonnistui', 400);
      }
    }

    const md = buildMarkdown({ title, date, author, category, photo: photoPath }, body);

    try {
      const headSha = await getBranchHead(token, branch);
      const baseTree = (await getCommit(token, headSha)).tree.sha;
      const treeItems = [];
      if (imageItem) {
        const bytes = new Uint8Array(await imageItem.file.arrayBuffer());
        const imgBlob = await createBlob(token, bytesToBase64(bytes));
        treeItems.push({ path: imageItem.repoPath, mode: '100644', type: 'blob', sha: imgBlob.sha });
      }
      const blob = await createBlob(token, utf8ToBase64(md));
      treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      const tree = await createTree(token, baseTree, treeItems);
      const commit = await createCommit(token, `Yleinen Kynä: new pikauutinen "${title}" (${author})`, tree.sha, headSha);
      await updateBranch(token, branch, commit.sha);
    } catch (e) {
      console.error('GitHub commit failed:', e);
      return fail('Pikauutisen tallennus epäonnistui', 502);
    }

    try {
      await env.DB.prepare(
        `INSERT INTO submissions
           (type, status, title, author_id, author_name, author_email, category, github_slug, submitted_at,
            consent_photo, consent_photo_text, consent_content, consent_content_text, consent_at)
         VALUES ('pikauutinen', 'odottaa', ?, ?, ?, ?, ?, ?, datetime('now'), 1, ?, 1, ?, datetime('now'))`
      ).bind(title, auth.user.id, author, auth.user.email || null, category, base, CONSENT_PHOTO_TEXT, CONSENT_CONTENT_TEXT).run();
    } catch (e) {
      console.error('submissions insert failed (non-fatal):', e?.name, e?.message, e?.cause, String(e));
    }

    let emailWarning = null;
    if (env.RESEND_API_KEY) {
      try {
        const sveltiaCmsUrl = (env.CF_PAGES_BRANCH === 'main' || !env.CF_PAGES_BRANCH)
          ? 'https://www.photoandmoto.fi/admin/#/collections/pikauutiset'
          : 'https://photoandmoto-staging.pages.dev/admin/#/collections/pikauutiset';
        const text =
`Otsikko: ${title}
Lähettäjä: ${author}
Kategoria: ${category}
Lähetetty: ${new Date().toISOString()}

Avaa Sveltia: ${sveltiaCmsUrl}`;
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM,
            to: [EDITOR_INBOX],
            reply_to: auth.user.email || undefined,
            subject: `Uusi pikauutinen odottaa tarkistusta — ${title}`,
            text,
          }),
        });
        if (!res.ok) { emailWarning = 'Ilmoitussähköpostin lähetys epäonnistui'; console.error('Resend error (pikauutinen):', res.status, await res.text().catch(() => '')); }
      } catch (e) {
        emailWarning = 'Ilmoitussähköpostin lähetys epäonnistui';
        console.error('Resend threw (pikauutinen):', e);
      }
    } else {
      emailWarning = 'RESEND_API_KEY puuttuu — ilmoitusta ei lähetetty';
    }

    return ok({ email_warning: emailWarning });
  } catch (e) {
    console.error('submit-pikauutinen unexpected error:', e);
    return fail('Palvelinvirhe', 500);
  }
}
