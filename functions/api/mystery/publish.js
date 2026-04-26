// POST /api/mystery/publish
//
// Triggered by admin clicking "Julkaise Galleriaan" in the Tunnista kuva modal.
//
// Steps:
//   1. Auth (admin password)
//   2. Fetch photo + metadata from D1
//   3. Decode base64 image -> binary
//   4. Sanitize metadata into a filename (people-location-year.jpg)
//   5. Authenticate as the GitHub App (sign JWT, get installation token)
//   6. Determine target branch from CF Pages env (preview = dev, production = main)
//   7. Atomic commit:
//        - public/galleries/<slug>/<filename>.jpg  (original image)
//        - src/content/galleries/<slug>.json       (only if new gallery — minimal stub)
//   8. Mark D1 row published_to_gallery_at, then delete photo row + comments
//   9. Return success with the committed filename + slug
//
// Body shape:
//   {
//     password: "...",
//     photo_id: 123,
//     gallery_slug: "suomi-80s",       // existing slug, OR new one if create_new
//     gallery_title: "Suomi 80s",      // only used when create_new is true
//     create_new: false,               // true when admin chose "Luo uusi galleria"
//     filename_override: "..."         // optional, admin-edited filename without extension
//   }

// ---------------------------------------------------------------------------
// Helpers — JSON responses
// ---------------------------------------------------------------------------

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function badRequest(msg)    { return jsonResponse({ error: msg }, 400); }
function unauthorized(msg)  { return jsonResponse({ error: msg || 'Unauthorized' }, 401); }
function notFound(msg)      { return jsonResponse({ error: msg || 'Not found' }, 404); }
function serverError(msg)   { return jsonResponse({ error: msg || 'Server error' }, 500); }

// ---------------------------------------------------------------------------
// Helpers — base64 conversions (Workers don't have Node Buffer)
// ---------------------------------------------------------------------------

function base64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  // Chunked to avoid stack overflow on large images
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

function utf8ToBase64(str) {
  return bytesToBase64(new TextEncoder().encode(str));
}

// base64url encoding (no padding, URL-safe alphabet) — needed for JWT
function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function utf8ToBase64Url(str) {
  return bytesToBase64Url(new TextEncoder().encode(str));
}

// ---------------------------------------------------------------------------
// Helpers — sanitize metadata into a safe filename
// ---------------------------------------------------------------------------
//
// Per the agreed design (option (a)): filename IS the caption source.
// Composing: people + location + year -> "Heikki-Mikkola-Hyvinkaa-1978"
// The Sharp script's --add path turns underscores into spaces for the caption.
// We use spaces in the filename to match the existing gallery convention
// (e.g. "Hyvinkää Jukka Laaksonen Honda 1980-82.jpg") since the script
// only converts underscores, not spaces.

function buildFilename(people, location, year) {
  const parts = [people, location, year].map(s => (s || '').trim()).filter(Boolean);
  let base = parts.join(' ');

  // Strip characters that are problematic in filenames OR git paths.
  // Allow letters (incl. accented), digits, spaces, hyphens, dots.
  base = base
    .replace(/[\\/:*?"<>|]/g, '')   // Windows/git-illegal characters
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim();

  if (!base) base = 'untitled';
  return `${base}.jpg`;
}

function sanitizeSlug(slug) {
  // Slugs go in URL paths and folder names — strict ASCII, lowercase, hyphens only.
  return String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatTitleFromSlug(slug) {
  const romanNumerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
  return slug.split('-').map(w => {
    if (romanNumerals.includes(w.toLowerCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function determineCategory(slug) {
  if (slug.includes('international')) return 'international';
  if (slug.includes('suomi') || slug.includes('finland')) return 'finland';
  if (slug.includes('enduro')) return 'enduro';
  if (slug.includes('scramble')) return 'scramble';
  if (slug.includes('black')) return 'black-white';
  return 'international';
}

// ---------------------------------------------------------------------------
// GitHub App authentication
// ---------------------------------------------------------------------------
//
// 1. Sign a JWT with the App's private key (RS256)
// 2. POST that JWT to GitHub to exchange for a short-lived installation token
// 3. Use the installation token as a bearer for repo operations
//
// We use Web Crypto API (available in Workers) instead of Node's crypto.

async function importPrivateKey(pemString) {
  // PEM -> DER bytes
  const pem = pemString
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const der = base64ToBytes(pem);

  // Try PKCS#8 first (modern format). Some GitHub-issued keys are PKCS#1 RSA.
  // We attempt PKCS#8 import; if it fails, we wrap PKCS#1 in PKCS#8 envelope.
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch (e) {
    // Wrap PKCS#1 -> PKCS#8 (prepend the standard RSA OID header)
    const pkcs8Header = new Uint8Array([
      0x30, 0x82, 0x00, 0x00,  // SEQUENCE, length placeholder (overwritten below)
      0x02, 0x01, 0x00,         // INTEGER 0 (version)
      0x30, 0x0d,               // SEQUENCE (algorithm identifier)
      0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // OID rsaEncryption
      0x05, 0x00,               // NULL params
      0x04, 0x82, 0x00, 0x00,  // OCTET STRING (length placeholder)
    ]);

    const totalLen = pkcs8Header.length + der.length;
    const inner = der.length;

    // Patch the two length fields (4-byte big-endian after each length tag)
    pkcs8Header[2] = ((totalLen - 4) >> 8) & 0xff;
    pkcs8Header[3] = (totalLen - 4) & 0xff;
    pkcs8Header[pkcs8Header.length - 2] = (inner >> 8) & 0xff;
    pkcs8Header[pkcs8Header.length - 1] = inner & 0xff;

    const wrapped = new Uint8Array(totalLen);
    wrapped.set(pkcs8Header, 0);
    wrapped.set(der, pkcs8Header.length);

    return await crypto.subtle.importKey(
      'pkcs8',
      wrapped,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  }
}

async function signAppJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  // Issued 60s in the past to absorb clock skew, expires in 8 minutes (max 10 allowed)
  const payload = { iat: now - 60, exp: now + 8 * 60, iss: String(appId) };

  const headerB64  = utf8ToBase64Url(JSON.stringify(header));
  const payloadB64 = utf8ToBase64Url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
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
  return data.token; // valid for ~1 hour
}

// ---------------------------------------------------------------------------
// GitHub commit helpers (using the Git Data API for atomic multi-file commits)
// ---------------------------------------------------------------------------

const REPO_OWNER = 'photoandmoto';
const REPO_NAME = 'photoandmoto';

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
  return ref.object.sha; // commit SHA
}

async function getCommit(token, commitSha) {
  return gh(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${commitSha}`);
}

async function createBlob(token, contentBase64) {
  return gh(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: contentBase64, encoding: 'base64' }),
  });
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
  // Returns true if path exists on branch, false otherwise. Throws on real errors.
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
  throw new Error(`GitHub contents check failed (${res.status}): ${text}`);
}

// ---------------------------------------------------------------------------
// Pick target branch from Cloudflare Pages env
// ---------------------------------------------------------------------------
//
// On photoandmoto-staging, CF_PAGES_BRANCH = 'dev'.
// On photoandmoto (live),   CF_PAGES_BRANCH = 'main'.
// If unset (e.g. local), default to 'dev' to be safe.

function targetBranch(env) {
  const b = env.CF_PAGES_BRANCH || env.CF_PAGES_TARGET_BRANCH || '';
  if (b === 'main') return 'main';
  return 'dev';
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function onRequestPost({ request, env }) {
  // ---- 1. Parse + auth ----
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const password = body.password || request.headers.get('X-Admin-Password') || '';
  if (!env.UPLOAD_PASSWORD) return serverError('UPLOAD_PASSWORD not configured');
  if (password !== env.UPLOAD_PASSWORD) return unauthorized();

  if (!env.DB) return serverError('D1 binding (DB) missing');
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return serverError('GitHub App secrets missing');
  }

  const photoId = parseInt(body.photo_id, 10);
  if (!Number.isFinite(photoId) || photoId <= 0) return badRequest('photo_id required');

  const slug = sanitizeSlug(body.gallery_slug);
  if (!slug) return badRequest('gallery_slug required');

  const createNew = !!body.create_new;
  const galleryTitle = (body.gallery_title || formatTitleFromSlug(slug)).trim();

  // ---- 2. Fetch photo from D1 ----
  let photo;
  try {
    photo = await env.DB
      .prepare('SELECT id, filename, image_data, year_estimate, people, location_notes, status, published_to_gallery_at FROM photos WHERE id = ?')
      .bind(photoId)
      .first();
  } catch (e) {
    return serverError(`D1 read failed: ${e.message}`);
  }

  if (!photo) return notFound('Photo not found');
  if (photo.published_to_gallery_at) {
    return badRequest('Photo already published — cannot publish twice');
  }
  if (photo.status !== 'identified') {
    return badRequest(`Photo status is "${photo.status}" — must be "identified"`);
  }

  // ---- 3. Build filename + image bytes ----
  let filename;
  if (body.filename_override && typeof body.filename_override === 'string') {
    const cleaned = body.filename_override.trim().replace(/\.(jpg|jpeg|png|webp)$/i, '');
    filename = cleaned ? `${cleaned}.jpg` : buildFilename(photo.people, photo.location_notes, photo.year_estimate);
  } else {
    filename = buildFilename(photo.people, photo.location_notes, photo.year_estimate);
  }

  let imageBase64 = photo.image_data || '';
  // Some uploads were stored as data URLs; strip prefix if present.
  const commaIdx = imageBase64.indexOf(',');
  if (imageBase64.startsWith('data:') && commaIdx !== -1) {
    imageBase64 = imageBase64.slice(commaIdx + 1);
  }
  if (!imageBase64) return badRequest('Photo has no image data');

  // ---- 4. GitHub App auth ----
  let token;
  try {
    const appJwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
    token = await getInstallationToken(appJwt, env.GITHUB_APP_INSTALLATION_ID);
  } catch (e) {
    return serverError(`GitHub auth failed: ${e.message}`);
  }

  const branch = targetBranch(env);
  const imagePath    = `public/galleries/${slug}/${filename}`;
  const manifestPath = `src/content/galleries/${slug}.json`;

  // ---- 5. Pre-flight: avoid filename collision ----
  try {
    const exists = await fileExists(token, branch, imagePath);
    if (exists) {
      return badRequest(`A photo named "${filename}" already exists in ${slug}. Edit the filename and try again.`);
    }
  } catch (e) {
    return serverError(`Pre-flight check failed: ${e.message}`);
  }

  // ---- 6. Build atomic commit ----
  let commitResult;
  try {
    const headSha   = await getBranchHead(token, branch);
    const headCommit = await getCommit(token, headSha);
    const baseTree  = headCommit.tree.sha;

    // Always commit the image
    const imageBlob = await createBlob(token, imageBase64);
    const treeEntries = [
      { path: imagePath, mode: '100644', type: 'blob', sha: imageBlob.sha },
    ];

    // If creating a new gallery, also commit a stub manifest so the gallery exists
    // immediately after this commit. The Action will then re-process and update
    // it with the real entry + dimensions when the image lands.
    //
    // For existing galleries we DON'T touch the manifest — the Action handles it.
    if (createNew) {
      const stub = {
        title: galleryTitle || formatTitleFromSlug(slug),
        slug,
        description: `Photo gallery: ${galleryTitle || formatTitleFromSlug(slug)}`,
        cover_image: '',
        images: [],
        category: determineCategory(slug),
      };
      const manifestBlob = await createBlob(token, utf8ToBase64(JSON.stringify(stub, null, 2) + '\n'));
      treeEntries.push({ path: manifestPath, mode: '100644', type: 'blob', sha: manifestBlob.sha });
    }

    const newTree = await createTree(token, baseTree, treeEntries);
    const message = `Gallery: publish photo #${photoId} to ${slug}`;
    const newCommit = await createCommit(token, message, newTree.sha, headSha);
    commitResult = await updateBranch(token, branch, newCommit.sha);
  } catch (e) {
    return serverError(`GitHub commit failed: ${e.message}`);
  }

  // ---- 7. Mark + delete D1 rows ----
  // We mark first, then delete. Even if delete fails, the row is flagged
  // "published" so it stops appearing in admin/community views.
  const nowIso = new Date().toISOString();
  let cleanupWarning = null;
  try {
    await env.DB
      .prepare('UPDATE photos SET published_to_gallery_at = ? WHERE id = ?')
      .bind(nowIso, photoId)
      .run();

    await env.DB.prepare('DELETE FROM comments WHERE photo_id = ?').bind(photoId).run();
    await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(photoId).run();
  } catch (e) {
    // The commit succeeded — image is in the repo. Don't fail the request.
    // Surface a warning so admin knows D1 has an orphan row to clean up.
    cleanupWarning = `D1 cleanup failed: ${e.message}`;
  }

  return jsonResponse({
    success: true,
    branch,
    commit_sha: commitResult.object?.sha || null,
    image_path: imagePath,
    gallery_slug: slug,
    filename,
    created_new_gallery: createNew,
    cleanup_warning: cleanupWarning,
  });
}
