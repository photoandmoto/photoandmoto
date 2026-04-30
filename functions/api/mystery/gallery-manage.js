// functions/api/mystery/gallery-manage.js
//
// Admin-only endpoint for managing published galleries.
//
// POST body: { password, action, gallery_slug, ...action-specific fields }
//
// Actions:
//   list_gallery_photos  — list all photos in a gallery (from manifest)
//   delete_photo         — remove original + thumb + display + manifest entry
//   update_caption       — update a photo's caption in the manifest
//   delete_gallery       — delete the gallery manifest (unpublishes the gallery)
//   rename_gallery       — update the gallery title field in the manifest

// ---------------------------------------------------------------------------
// Helpers — JSON responses
// ---------------------------------------------------------------------------

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
function badRequest(msg)   { return jsonResponse({ error: msg }, 400); }
function unauthorized()    { return jsonResponse({ error: 'Unauthorized' }, 401); }
function serverError(msg)  { return jsonResponse({ error: msg || 'Server error' }, 500); }

// ---------------------------------------------------------------------------
// GitHub App auth (same pattern as publish.js / galleries.js)
// ---------------------------------------------------------------------------

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK)
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(out);
}

function utf8ToBase64(str) {
  return bytesToBase64(new TextEncoder().encode(str));
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8ToBase64Url(str) {
  return bytesToBase64Url(new TextEncoder().encode(str));
}

async function importPrivateKey(pem) {
  const cleaned = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const der = base64ToBytes(cleaned);
  try {
    return await crypto.subtle.importKey('pkcs8', der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    // Wrap PKCS#1 -> PKCS#8
    const rsaOid = new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);
    const version = new Uint8Array([0x02,0x01,0x00]);
    const octetLen = der.length;
    const octetHdr = octetLen < 128 ? new Uint8Array([0x04, octetLen])
      : octetLen < 256 ? new Uint8Array([0x04, 0x81, octetLen])
      : new Uint8Array([0x04, 0x82, (octetLen>>8)&0xff, octetLen&0xff]);
    const inner = concat(version, rsaOid, octetHdr, der);
    const outerLen = inner.length;
    const outerHdr = outerLen < 128 ? new Uint8Array([0x30, outerLen])
      : outerLen < 256 ? new Uint8Array([0x30, 0x81, outerLen])
      : new Uint8Array([0x30, 0x82, (outerLen>>8)&0xff, outerLen&0xff]);
    const wrapped = concat(outerHdr, inner);
    return await crypto.subtle.importKey('pkcs8', wrapped,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function signAppJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 8 * 60, iss: String(appId) };
  const h = utf8ToBase64Url(JSON.stringify(header));
  const p = utf8ToBase64Url(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

async function getInstallationToken(env) {
  const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const r = await fetch(
    `https://api.github.com/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
    { method: 'POST', headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'photoandmoto-publisher',
    }}
  );
  if (!r.ok) { const t = await r.text(); throw new Error(`token: ${r.status} ${t}`); }
  return (await r.json()).token;
}

// ---------------------------------------------------------------------------
// GitHub Git Data API helpers
// ---------------------------------------------------------------------------

const OWNER = 'photoandmoto';
const REPO  = 'photoandmoto';

async function gh(token, path, init = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'photoandmoto-publisher',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`GH ${path} → ${r.status}: ${t}`); }
  return r.json();
}

async function getBranchHead(token, branch) {
  const ref = await gh(token, `/repos/${OWNER}/${REPO}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

async function getCommit(token, sha) {
  return gh(token, `/repos/${OWNER}/${REPO}/git/commits/${sha}`);
}

async function createBlob(token, contentBase64) {
  return gh(token, `/repos/${OWNER}/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: contentBase64, encoding: 'base64' }),
  });
}

async function createTree(token, baseTreeSha, entries) {
  return gh(token, `/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  });
}

async function createCommit(token, message, treeSha, parentSha) {
  return gh(token, `/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
}

async function updateBranch(token, branch, commitSha) {
  return gh(token, `/repos/${OWNER}/${REPO}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
}

// Fetch raw file content from GitHub → returns { content (base64), sha (blob sha) }
async function fetchFile(token, branch, filePath) {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  const data = await gh(token, `/repos/${OWNER}/${REPO}/contents/${encoded}?ref=${encodeURIComponent(branch)}`);
  return { content: (data.content || '').replace(/\n/g, ''), sha: data.sha };
}

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

async function fetchManifest(token, branch, slug) {
  const path = `src/content/galleries/${slug}.json`;
  const { content } = await fetchFile(token, branch, path);
  const bytes = base64ToBytes(content);
  const decoded = new TextDecoder('utf-8').decode(bytes);
  return JSON.parse(decoded);
}

// Commit an updated manifest (and optionally delete/add other files in same commit)
async function commitChanges(token, branch, message, fileChanges) {
  // fileChanges: array of { path, base64Content | null (null = delete) }
  const headSha   = await getBranchHead(token, branch);
  const headCommit = await getCommit(token, headSha);
  const baseTree  = headCommit.tree.sha;

  const treeEntries = await Promise.all(fileChanges.map(async (fc) => {
    if (fc.base64Content === null) {
      // Delete: sha null
      return { path: fc.path, mode: '100644', type: 'blob', sha: null };
    } else {
      const blob = await createBlob(token, fc.base64Content);
      return { path: fc.path, mode: '100644', type: 'blob', sha: blob.sha };
    }
  }));

  const newTree   = await createTree(token, baseTree, treeEntries);
  const newCommit = await createCommit(token, message, newTree.sha, headSha);
  return updateBranch(token, branch, newCommit.sha);
}

// ---------------------------------------------------------------------------
// Branch detection
// ---------------------------------------------------------------------------

function targetBranch(env) {
  const b = env.CF_PAGES_BRANCH || env.CF_PAGES_TARGET_BRANCH || '';
  return b === 'main' ? 'main' : 'dev';
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function actionListGalleryPhotos(token, branch, slug) {
  const manifest = await fetchManifest(token, branch, slug);
  return jsonResponse({
    success: true,
    title: manifest.title,
    slug,
    photos: (manifest.images || []).map(img => ({
      filename: img.filename,
      caption:  img.caption || img.filename,
      thumb:    img.thumb,
      display:  img.display,
      date:     img.date || '',
    })),
  });
}

async function actionDeletePhoto(token, branch, slug, filename) {
  const manifest = await fetchManifest(token, branch, slug);
  const idx = manifest.images.findIndex(i => i.filename === filename);
  if (idx === -1) return badRequest(`Photo "${filename}" not found in ${slug}`);

  const entry = manifest.images[idx];
  manifest.images.splice(idx, 1);
  // Update cover_image if it pointed to this photo's thumb
  if (manifest.cover_image === entry.thumb && manifest.images.length > 0) {
    manifest.cover_image = manifest.images[0].thumb;
  }

  const base  = `public/galleries/${slug}`;
  const changes = [
    // Delete original
    { path: `${base}/${filename}`, base64Content: null },
    // Delete thumb
    { path: `${base}/${entry.thumb}`, base64Content: null },
    // Delete display
    { path: `${base}/${entry.display}`, base64Content: null },
    // Update manifest
    {
      path: `src/content/galleries/${slug}.json`,
      base64Content: utf8ToBase64(JSON.stringify(manifest, null, 2) + '\n'),
    },
  ];

  await commitChanges(token, branch, `Gallery: delete photo "${filename}" from ${slug}`, changes);
  return jsonResponse({ success: true, slug, deleted: filename });
}

async function actionUpdateCaption(token, branch, slug, filename, newCaption) {
  const manifest = await fetchManifest(token, branch, slug);
  const entry = manifest.images.find(i => i.filename === filename);
  if (!entry) return badRequest(`Photo "${filename}" not found in ${slug}`);

  entry.caption = newCaption.trim();

  const changes = [{
    path: `src/content/galleries/${slug}.json`,
    base64Content: utf8ToBase64(JSON.stringify(manifest, null, 2) + '\n'),
  }];

  await commitChanges(token, branch, `Gallery: update caption for "${filename}" in ${slug}`, changes);
  return jsonResponse({ success: true, slug, filename, caption: entry.caption });
}

async function actionDeleteGallery(token, branch, slug) {
  // Delete the manifest — Astro won't generate the gallery page on next build.
  // Image files remain in git (safe, not served as gallery).
  const changes = [{
    path: `src/content/galleries/${slug}.json`,
    base64Content: null,
  }];
  await commitChanges(token, branch, `Gallery: delete gallery "${slug}"`, changes);
  return jsonResponse({ success: true, slug });
}

async function actionRenameGallery(token, branch, slug, newTitle) {
  const manifest = await fetchManifest(token, branch, slug);
  manifest.title = newTitle.trim();
  const changes = [{
    path: `src/content/galleries/${slug}.json`,
    base64Content: utf8ToBase64(JSON.stringify(manifest, null, 2) + '\n'),
  }];
  await commitChanges(token, branch, `Gallery: rename "${slug}" → "${newTitle}"`, changes);
  return jsonResponse({ success: true, slug, title: manifest.title });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return badRequest('Invalid JSON'); }

  if (!env.UPLOAD_PASSWORD) return serverError('UPLOAD_PASSWORD not configured');
  if ((body.password || '') !== env.UPLOAD_PASSWORD) return unauthorized();
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY)
    return serverError('GitHub App secrets missing');

  const slug = (body.gallery_slug || '').trim();
  if (!slug) return badRequest('gallery_slug required');

  const action = body.action || '';
  const branch = targetBranch(env);

  let token;
  try { token = await getInstallationToken(env); }
  catch (e) { return serverError(`GitHub auth failed: ${e.message}`); }

  try {
    switch (action) {
      case 'list_gallery_photos':
        return await actionListGalleryPhotos(token, branch, slug);

      case 'delete_photo': {
        const filename = (body.filename || '').trim();
        if (!filename) return badRequest('filename required');
        return await actionDeletePhoto(token, branch, slug, filename);
      }

      case 'update_caption': {
        const filename   = (body.filename || '').trim();
        const newCaption = (body.caption || '').trim();
        if (!filename)   return badRequest('filename required');
        if (!newCaption) return badRequest('caption required');
        return await actionUpdateCaption(token, branch, slug, filename, newCaption);
      }

      case 'delete_gallery':
        return await actionDeleteGallery(token, branch, slug);

      case 'rename_gallery': {
        const newTitle = (body.title || '').trim();
        if (!newTitle) return badRequest('title required');
        return await actionRenameGallery(token, branch, slug, newTitle);
      }

      default:
        return badRequest(`Unknown action: ${action}`);
    }
  } catch (e) {
    return serverError(`Action "${action}" failed: ${e.message}`);
  }
}
