// POST /api/submit-article
//
// Yleinen Kynä Phase 1 — a logged-in contributor (perm_laheta_artikkeli) submits
// an article + photos. Flow:
//   1. requireAuth(..., 'laheta_artikkeli')
//   2. Parse multipart form, validate
//   3. Build a draft .md (draft: true; author from IAM session; seo_description null)
//   4. Commit the .md AND the photos (public/images/<filename>) to the target
//      branch (dev on staging, main on production) in one Photoandmoto Publisher
//      App commit — images live in the repo so Sveltia's media library and the
//      static build both resolve /images/<file> directly (no R2).
//   5. Email the editor via Resend
//
// Hard rules (YLEINEN_KYNA.md): author is ALWAYS the IAM session name (never the
// form); draft is ALWAYS true; photo filenames are sanitized (no colons, spaces
// → hyphens). The committed frontmatter must pass the Zod schema in
// src/content.config.ts or the staging build breaks.

import { requireAuth } from '../_lib/auth.js';

const REPO_OWNER = 'photoandmoto';
const REPO_NAME = 'photoandmoto';
const EDITOR_INBOX = 'photoandmoto@gmail.com';
const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per photo
// Must match the categories collection (src/content/categories/) — the `name`
// values, not the Finnish labels.
const ALLOWED_CATEGORIES = [
  'Enduro', 'Interview', 'Profile', 'Historical', 'Ice speedway', 'Long Track',
  'Motocross', 'MXGP', 'Scramble', 'Speedway', 'Technical', 'Trail',
];

// ---------------------------------------------------------------------------
// JSON responses
// ---------------------------------------------------------------------------
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const ok = (d) => json({ ok: true, ...d });
const fail = (msg, status = 400) => json({ ok: false, error: msg }, status);

// ---------------------------------------------------------------------------
// base64 / JWT helpers (copied from functions/api/mystery/publish.js)
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
// Slug + filename sanitization (ASCII, Windows/git-safe — no colons, spaces->-)
// ---------------------------------------------------------------------------
function foldNordic(s) {
  return s.replace(/[äà]/g, 'a').replace(/[öø]/g, 'o').replace(/å/g, 'a').replace(/[éè]/g, 'e').replace(/ü/g, 'u');
}
function slugify(title) {
  const s = foldNordic(String(title || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'artikkeli';
}
function sanitizeImageName(name) {
  const dot = String(name || '').lastIndexOf('.');
  let base = dot > 0 ? name.slice(0, dot) : (name || 'kuva');
  let ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  base = foldNordic(base.toLowerCase())
    .replace(/[\\/:*?"<>|]/g, '')   // Windows/git-illegal characters
    .replace(/\s+/g, '-')           // spaces -> hyphens
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!base) base = 'kuva';
  if (!/^\.(jpe?g|png|webp)$/.test(ext)) ext = '.jpg';
  return base + ext;
}

// YAML scalar via JSON (JSON strings are valid YAML and handle escaping).
function buildMarkdown(fm, body) {
  const L = [
    '---',
    `title: ${JSON.stringify(fm.title)}`,
    `subtitle: ${fm.subtitle ? JSON.stringify(fm.subtitle) : 'null'}`,
    `author: ${JSON.stringify(fm.author)}`,
    `date: ${fm.date}`,
    `category: ${JSON.stringify(fm.category)}`,
    `tags: ${JSON.stringify(fm.tags)}`,
    `featured_image: ${JSON.stringify(fm.featured_image)}`,
    `card_image: ${fm.card_image ? JSON.stringify(fm.card_image) : 'null'}`,
    `image_caption: ${fm.image_caption ? JSON.stringify(fm.image_caption) : 'null'}`,
    `language: "fi"`,
    `show_hero: true`,
    `draft: true`,
    `seo_description: null`,
    `sources: ${fm.sources ? JSON.stringify(fm.sources) : 'null'}`,
    '---',
    '',
    body,
    '',
  ];
  return L.join('\n');
}

// Prepare one File for committing to the repo at public/images/<slug>-<name>.
// Bytes are read later, at commit time. Returns the repo path + public URL path.
function prepareImage(slug, file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`Kuva on liian suuri (max 10 MB): ${file.name}`);
  const safe = `${slug}-${sanitizeImageName(file.name)}`;
  return { repoPath: `public/images/${safe}`, publicPath: `/images/${safe}`, file };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function onRequestPost({ request, env }) {
  try {
    // 1. Auth — contributor must have perm_laheta_artikkeli.
    const auth = await requireAuth(request, env, 'laheta_artikkeli');
    if (auth.error) return fail(auth.error, auth.status);

    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
      return fail('GitHub App -asetukset puuttuvat', 500);
    }

    // 2. Parse + validate the multipart form.
    let form;
    try { form = await request.formData(); } catch { return fail('Virheellinen lomakedata', 400); }

    const title = (form.get('title') || '').toString().trim();
    const subtitle = (form.get('subtitle') || '').toString().trim();
    const category = (form.get('category') || '').toString().trim();
    const imageCaption = (form.get('image_caption') || '').toString().trim();
    const sources = (form.get('sources') || '').toString().trim();
    const bodyText = (form.get('body') || '').toString().trim();
    const tags = (form.get('tags') || '').toString().split(',').map(t => t.trim()).filter(Boolean);

    if (title.length < 5) return fail('Otsikko on pakollinen (vähintään 5 merkkiä)', 400);
    if (!ALLOWED_CATEGORIES.includes(category)) return fail('Valitse kelvollinen kategoria', 400);
    if (!bodyText) return fail('Sisältö on pakollinen', 400);

    const featured = form.get('featured_image');
    if (!featured || typeof featured === 'string' || featured.size === 0) {
      return fail('Pääkuva on pakollinen', 400);
    }
    const card = form.get('card_image');
    const bodyImages = form.getAll('body_images').filter(f => f && typeof f !== 'string' && f.size > 0);

    // Author ALWAYS from the IAM session — never from the form.
    const author = `${auth.user.first_name || ''} ${auth.user.last_name || ''}`.trim() || 'Photo & Moto';
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // 3. GitHub App auth + unique slug.
    const branch = targetBranch(env);
    let token;
    try {
      const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
      token = await getInstallationToken(jwt, env.GITHUB_APP_INSTALLATION_ID);
    } catch (e) {
      console.error('GitHub auth failed:', e);
      return fail('GitHub-todennus epäonnistui', 502);
    }

    let slug = slugify(title);
    try {
      if (await fileExists(token, branch, `src/content/articles/fi/${slug}.md`)) {
        slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
      }
    } catch (e) {
      console.error('slug pre-flight failed:', e);
      return fail('GitHubin tarkistus epäonnistui', 502);
    }

    // 4. Collect the photos to commit into the repo (public/images/).
    let featuredPath, cardPath = null;
    const bodyImagePaths = [];
    const images = []; // { repoPath, publicPath, file } — committed alongside the .md
    try {
      const f = prepareImage(slug, featured);
      featuredPath = f.publicPath; images.push(f);
      if (card && typeof card !== 'string' && card.size > 0) {
        const c = prepareImage(slug, card);
        cardPath = c.publicPath; images.push(c);
      }
      for (const img of bodyImages) {
        const b = prepareImage(slug, img);
        bodyImagePaths.push(b.publicPath); images.push(b);
      }
    } catch (e) {
      console.error('image prepare failed:', e);
      return fail(e.message || 'Kuvien käsittely epäonnistui', 400);
    }

    // 5. Build the draft markdown (append any body images for the editor to place).
    let finalBody = bodyText;
    if (bodyImagePaths.length) {
      finalBody += '\n\n' + bodyImagePaths.map(p => `![](${p})`).join('\n\n');
    }
    const md = buildMarkdown(
      { title, subtitle, author, date, category, tags, featured_image: featuredPath, card_image: cardPath, image_caption: imageCaption, sources },
      finalBody
    );

    // 6. Commit the draft to the target branch.
    let commitSha = null;
    try {
      const headSha = await getBranchHead(token, branch);
      const baseTree = (await getCommit(token, headSha)).tree.sha;

      const treeItems = [];
      // Image blobs first (base64 of the raw bytes).
      for (const img of images) {
        const bytes = new Uint8Array(await img.file.arrayBuffer());
        const imgBlob = await createBlob(token, bytesToBase64(bytes));
        treeItems.push({ path: img.repoPath, mode: '100644', type: 'blob', sha: imgBlob.sha });
      }
      // Then the article markdown.
      const blob = await createBlob(token, utf8ToBase64(md));
      treeItems.push({ path: `src/content/articles/fi/${slug}.md`, mode: '100644', type: 'blob', sha: blob.sha });

      const tree = await createTree(token, baseTree, treeItems);
      const commit = await createCommit(token, `Yleinen Kynä: new draft "${title}" (${author})`, tree.sha, headSha);
      const upd = await updateBranch(token, branch, commit.sha);
      commitSha = upd.object?.sha || commit.sha;
    } catch (e) {
      console.error('GitHub commit failed:', e);
      return fail('Artikkelin tallennus epäonnistui', 502);
    }

    // 7. Notify the editor via Resend (non-fatal — the draft is already committed).
    let emailWarning = null;
    if (env.RESEND_API_KEY) {
      try {
        const text =
`Otsikko: ${title}
Lähettäjä: ${author}
Kategoria: ${category}
Lähetetty: ${new Date().toISOString()}

Avaa Sveltia: https://www.photoandmoto.fi/admin/`;
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM,
            to: [EDITOR_INBOX],
            reply_to: auth.user.email || undefined,
            subject: `Uusi artikkeli odottaa tarkistusta — ${title}`,
            text,
          }),
        });
        if (!res.ok) { emailWarning = 'Ilmoitussähköpostin lähetys epäonnistui'; console.error('Resend error (submit):', res.status, await res.text().catch(() => '')); }
      } catch (e) {
        emailWarning = 'Ilmoitussähköpostin lähetys epäonnistui';
        console.error('Resend threw (submit):', e);
      }
    } else {
      emailWarning = 'RESEND_API_KEY puuttuu — ilmoitusta ei lähetetty';
    }

    return ok({ slug, branch, commit_sha: commitSha, email_warning: emailWarning });
  } catch (e) {
    console.error('submit-article unexpected error:', e);
    return fail('Palvelinvirhe', 500);
  }
}
