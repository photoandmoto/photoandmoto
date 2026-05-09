// POST /api/articles/delete
//
// Removes an article and all its associated images in a single atomic git
// commit. Used by the Hallitse artikkeleita admin tab.
//
// Body shape (JSON):
//   {
//     password: "...",
//     mode: "draft" | "production",   // draft -> delete from dev, production -> delete from main
//     slug: "test-day2-publish",
//     language: "fi" | "en",
//     delete_both: false              // optional, true also deletes the other-language counterpart
//   }
//
// What gets removed (for the requested language):
//   - src/content/articles/<lang>/<slug>.md
//   - public/images/<slug>-hero.jpg   (if present)
//   - public/images/<slug>-<N>.jpg    (for every N that exists)
//
// If delete_both=true, the same set is removed for the OTHER language too.
// Note: images are shared across languages (FI and EN articles reference the
// same /images/<slug>-* paths), so when delete_both=true we still only need
// to remove each image file ONCE — handled by deduping below.
//
// Returns: { success, mode, branch, slug, deleted_files: [...] }

const REPO_OWNER = 'photoandmoto';
const REPO_NAME = 'photoandmoto';

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
function badRequest(msg)   { return jsonResponse({ error: msg }, 400); }
function unauthorized(msg) { return jsonResponse({ error: msg || 'Unauthorized' }, 401); }
function notFound(msg)     { return jsonResponse({ error: msg || 'Not found' }, 404); }
function serverError(msg)  { return jsonResponse({ error: msg || 'Server error' }, 500); }

// ---------------------------------------------------------------------------
// Base64 + JWT helpers (lifted from publish.js)
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

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8ToBase64Url(str) {
  return bytesToBase64Url(new TextEncoder().encode(str));
}

async function importPrivateKey(pemString) {
  const pem = pemString
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const der = base64ToBytes(pem);
  try {
    return await crypto.subtle.importKey(
      'pkcs8', der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign']
    );
  } catch (e) {
    const pkcs8Header = new Uint8Array([
      0x30, 0x82, 0x00, 0x00,
      0x02, 0x01, 0x00,
      0x30, 0x0d,
      0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
      0x05, 0x00,
      0x04, 0x82, 0x00, 0x00,
    ]);
    const totalLen = pkcs8Header.length + der.length;
    const inner = der.length;
    pkcs8Header[2] = ((totalLen - 4) >> 8) & 0xff;
    pkcs8Header[3] = (totalLen - 4) & 0xff;
    pkcs8Header[pkcs8Header.length - 2] = (inner >> 8) & 0xff;
    pkcs8Header[pkcs8Header.length - 1] = inner & 0xff;
    const wrapped = new Uint8Array(totalLen);
    wrapped.set(pkcs8Header, 0);
    wrapped.set(der, pkcs8Header.length);
    return await crypto.subtle.importKey(
      'pkcs8', wrapped,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign']
    );
  }
}

async function signAppJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 8 * 60, iss: String(appId) };
  const headerB64 = utf8ToBase64Url(JSON.stringify(header));
  const payloadB64 = utf8ToBase64Url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

async function getInstallationToken(appJwt, installationId) {
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appJwt}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'photoandmoto-publisher',
      },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Installation token request failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.token;
}

// ---------------------------------------------------------------------------
// GitHub Git Data API helpers
// ---------------------------------------------------------------------------

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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${init.method || 'GET'} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function getBranchHead(token, branch) {
  const ref = await gh(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

async function getCommit(token, commitSha) {
  return gh(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${commitSha}`);
}

async function createTree(token, baseTreeSha, entries) {
  return gh(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  });
}

async function createCommit(token, message, treeSha, parentSha) {
  return gh(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
}

async function updateBranch(token, branch, commitSha) {
  return gh(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
}

async function fileExists(token, branch, path) {
  // Returns true if the file exists on the branch.
  const url = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(`https://api.github.com${url}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'photoandmoto-publisher',
    },
  });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  const text = await res.text();
  throw new Error(`GitHub fileExists failed (${res.status}): ${text}`);
}

async function listImagesForSlug(token, branch, slug) {
  // List public/images/ on the branch and return paths whose name starts with <slug>-.
  const url = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/public/images?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(`https://api.github.com${url}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'photoandmoto-publisher',
    },
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub list public/images failed (${res.status}): ${text}`);
  }
  const items = await res.json();
  if (!Array.isArray(items)) return [];
  const prefix = `${slug}-`;
  return items
    .filter(it => it.type === 'file' && it.name.startsWith(prefix))
    .map(it => it.path);
}

// ---------------------------------------------------------------------------
// Slug sanitizer (mirror of publish.js)
// ---------------------------------------------------------------------------

function sanitizeSlug(slug) {
  return String(slug || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function onRequestPost({ request, env }) {
  // ---- Parse + auth ----
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const password = body.password || request.headers.get('X-Admin-Password') || '';
  if (!env.UPLOAD_PASSWORD) return serverError('UPLOAD_PASSWORD not configured');
  if (password !== env.UPLOAD_PASSWORD) return unauthorized();

  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return serverError('GitHub App secrets missing');
  }

  // ---- Validate input ----
  const mode = (body.mode || '').toString().toLowerCase();
  if (!['draft', 'production'].includes(mode)) {
    return badRequest('mode must be "draft" or "production"');
  }

  const slug = sanitizeSlug(body.slug);
  if (!slug) return badRequest('slug required');

  const language = (body.language || '').toString().toLowerCase();
  if (!['fi', 'en'].includes(language)) return badRequest('language must be fi or en');

  const deleteBoth = !!body.delete_both;
  const branch = mode === 'production' ? 'main' : 'dev';

  // ---- Auth GitHub ----
  let token;
  try {
    const appJwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
    token = await getInstallationToken(appJwt, env.GITHUB_APP_INSTALLATION_ID);
  } catch (e) {
    return serverError(`GitHub auth failed: ${e.message}`);
  }

  // ---- Build the list of paths to delete ----
  const pathsToDelete = new Set();

  try {
    // Article markdown (always for the requested language)
    const primaryPath = `src/content/articles/${language}/${slug}.md`;
    if (await fileExists(token, branch, primaryPath)) {
      pathsToDelete.add(primaryPath);
    }

    // Other language counterpart, if requested
    if (deleteBoth) {
      const otherLang = language === 'fi' ? 'en' : 'fi';
      const otherPath = `src/content/articles/${otherLang}/${slug}.md`;
      if (await fileExists(token, branch, otherPath)) {
        pathsToDelete.add(otherPath);
      }
    }

    // Images — only delete when removing both languages (or when only one
    // language exists in the first place). If deleteBoth=false and the OTHER
    // language counterpart exists on the branch, keep images so the surviving
    // article still renders. Check the other lang's existence regardless of
    // the deleteBoth flag, to decide image fate.
    const otherLang = language === 'fi' ? 'en' : 'fi';
    const otherPath = `src/content/articles/${otherLang}/${slug}.md`;
    const otherExists = await fileExists(token, branch, otherPath);
    const removingAllArticles = deleteBoth || !otherExists;

    if (removingAllArticles) {
      const images = await listImagesForSlug(token, branch, slug);
      for (const p of images) pathsToDelete.add(p);
    }
  } catch (e) {
    return serverError(`Pre-flight failed: ${e.message}`);
  }

  if (pathsToDelete.size === 0) {
    return notFound(`No files found to delete for slug "${slug}" (${language}) on ${branch}`);
  }

  // ---- Build atomic delete commit ----
  // In Git Data API, deleting files in a tree means setting `sha: null` for each path.
  let commitResult;
  const deletedFiles = [...pathsToDelete];
  try {
    const headSha   = await getBranchHead(token, branch);
    const headCommit = await getCommit(token, headSha);
    const baseTree   = headCommit.tree.sha;

    const treeEntries = deletedFiles.map(path => ({
      path,
      mode: '100644',
      type: 'blob',
      sha: null, // null sha = remove
    }));

    const newTree = await createTree(token, baseTree, treeEntries);
    const fileWord = deletedFiles.length === 1 ? 'file' : 'files';
    const message = `Article: delete "${slug}" (${deleteBoth ? 'both languages' : language}) — ${deletedFiles.length} ${fileWord}`;
    const newCommit = await createCommit(token, message, newTree.sha, headSha);
    commitResult = await updateBranch(token, branch, newCommit.sha);
  } catch (e) {
    return serverError(`GitHub commit failed: ${e.message}`);
  }

  return jsonResponse({
    success: true,
    mode,
    branch,
    slug,
    language,
    delete_both: deleteBoth,
    deleted_files: deletedFiles,
    commit_sha: commitResult.object?.sha || null,
  });
}

// ---------------------------------------------------------------------------
// CORS preflight
// ---------------------------------------------------------------------------

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
    },
  });
}
