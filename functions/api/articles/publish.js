// POST /api/articles/publish
//
// Two modes (decided by 'mode' field in request body):
//
//   mode=draft       -> commits a brand-new (or updated) article to the `dev` branch
//                       Input: multipart/form-data with frontmatter fields, body,
//                              hero_image (optional), and inline_image_1..N (optional)
//                       Side effect: also writes a stub at en/<slug>.md for sitemap parity
//                                    if the FI article is the source.
//
//   mode=production  -> reads the article files from `dev` and commits the same
//                       files to `main` (image bytes copied via Git Data API, no
//                       re-upload required from the admin)
//                       Input: application/json { password, slug, language }
//
// Auth: same UPLOAD_PASSWORD pattern as mystery/publish.js, GitHub App JWT for
// repo writes.
//
// Image scheme (locked):
//   - hero:        public/images/<slug>-hero.jpg
//   - inline N:    public/images/<slug>-<N>.jpg  (N = 1, 2, 3, ...)
// Body placeholders [[image:N]] are replaced before commit with:
//   ![<caption-or-alt>](/images/<slug>-<N>.jpg)
//
// Article path:
//   src/content/articles/<lang>/<slug>.md

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
// Base64 helpers (Workers have no Buffer)
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

function utf8ToBase64(str) {
  return bytesToBase64(new TextEncoder().encode(str));
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8ToBase64Url(str) {
  return bytesToBase64Url(new TextEncoder().encode(str));
}

// ---------------------------------------------------------------------------
// Slug + frontmatter helpers
// ---------------------------------------------------------------------------

function sanitizeSlug(slug) {
  // Strict ASCII, lowercase, hyphens. Mirrors the gallery publish convention.
  return String(slug || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics (ä -> a, ö -> o, etc.)
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function yamlString(s) {
  // Emit a YAML-safe double-quoted string. Escape backslash and double-quote.
  const escaped = String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function yamlStringArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '[]';
  return '[' + arr.map(yamlString).join(', ') + ']';
}

function buildFrontmatter(meta) {
  // meta = { title, subtitle, author, date, category, tags[], featured_image, language, show_hero, seo_description }
  const lines = ['---'];
  lines.push(`title: ${yamlString(meta.title)}`);
  if (meta.subtitle) lines.push(`subtitle: ${yamlString(meta.subtitle)}`);
  lines.push(`author: ${yamlString(meta.author || 'Photo & Moto')}`);
  lines.push(`date: ${meta.date}`);
  lines.push(`category: ${yamlString(meta.category || '')}`);
  lines.push(`tags: ${yamlStringArray(meta.tags || [])}`);
  if (meta.featured_image) lines.push(`featured_image: ${yamlString(meta.featured_image)}`);
  lines.push(`language: ${yamlString(meta.language)}`);
  lines.push(`show_hero: ${meta.show_hero ? 'true' : 'false'}`);
  if (meta.seo_description) lines.push(`seo_description: ${yamlString(meta.seo_description)}`);
  lines.push('---');
  return lines.join('\n') + '\n';
}

function replaceImagePlaceholders(body, slug, captions) {
  // Replaces [[image:N]] and [[image:N|caption=...]] with markdown image syntax.
  // captions is { 1: 'alt for image 1', 2: '...' } as supplied by the form.
  return body.replace(/\[\[image:(\d+)(?:\|caption=([^\]]+))?\]\]/g, (_, num, inlineCaption) => {
    const n = parseInt(num, 10);
    const alt = (inlineCaption || captions[n] || `Kuva ${n}`).trim();
    return `![${alt}](/images/${slug}-${n}.jpg)`;
  });
}

// ---------------------------------------------------------------------------
// GitHub App auth (lifted from mystery/publish.js)
// ---------------------------------------------------------------------------

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
  return ref.object.sha;
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

async function getFileBlobSha(token, branch, path) {
  // Returns the blob SHA of a file at `path` on `branch`, or null if missing.
  const url = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(`https://api.github.com${url}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'photoandmoto-publisher',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub contents lookup failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.sha; // blob SHA — reusable directly in tree entries (same repo)
}

async function listImagesForSlug(token, branch, slug) {
  // List public/images/ on the branch and return entries whose name starts with <slug>-.
  // Used to copy all images from dev -> main when promoting.
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
    .map(it => ({ path: it.path, sha: it.sha, name: it.name }));
}

// ---------------------------------------------------------------------------
// Branch detection (preview vs prod) — for the draft path
// ---------------------------------------------------------------------------
// Drafts always go to `dev` regardless of which Pages project we're running on.
// (Even on production photoandmoto project, "save draft" should still target dev,
//  because dev = staging environment in our model.)
// Production promotion always targets `main`.

const DRAFT_BRANCH = 'dev';
const PROD_BRANCH  = 'main';

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function onRequestPost({ request, env }) {
  // Detect mode from Content-Type. Multipart -> draft. JSON -> production promote.
  const contentType = request.headers.get('content-type') || '';
  const isMultipart = contentType.includes('multipart/form-data');

  // Common: env preflight
  if (!env.UPLOAD_PASSWORD) return serverError('UPLOAD_PASSWORD not configured');
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return serverError('GitHub App secrets missing');
  }

  if (isMultipart) {
    return handleDraftSave({ request, env });
  } else {
    return handleProductionPromote({ request, env });
  }
}

// ---- Draft save: full form -> dev branch ----------------------------------

async function handleDraftSave({ request, env }) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return badRequest('Invalid multipart form');
  }

  const password = form.get('password') || '';
  if (password !== env.UPLOAD_PASSWORD) return unauthorized();

  const mode = (form.get('mode') || 'draft').toString();
  if (mode !== 'draft') return badRequest('Multipart upload only supports mode=draft');

  // Required fields
  const title    = (form.get('title') || '').toString().trim();
  const slugRaw  = (form.get('slug')  || '').toString().trim();
  const date     = (form.get('date')  || '').toString().trim();
  const language = (form.get('language') || 'fi').toString().trim();
  const category = (form.get('category') || '').toString().trim();
  const body     = (form.get('body') || '').toString();

  if (!title)    return badRequest('title required');
  if (!date)     return badRequest('date required (YYYY-MM-DD)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest('date must be YYYY-MM-DD');
  if (!category) return badRequest('category required');
  if (!body)     return badRequest('body required');
  if (!['fi', 'en'].includes(language)) return badRequest('language must be fi or en');

  const slug = sanitizeSlug(slugRaw || title);
  if (!slug) return badRequest('slug could not be derived');

  // Optional fields
  const subtitle       = (form.get('subtitle') || '').toString().trim();
  const author         = (form.get('author') || 'Photo & Moto').toString().trim();
  const tagsRaw        = (form.get('tags') || '').toString().trim();
  const showHero       = String(form.get('show_hero') || 'false').toLowerCase() === 'true';
  const seoDescription = (form.get('seo_description') || '').toString().trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  // Inline image captions: form fields image_1_caption, image_2_caption, ...
  const captions = {};
  for (const [key, val] of form.entries()) {
    const m = key.match(/^image_(\d+)_caption$/);
    if (m) captions[parseInt(m[1], 10)] = val.toString();
  }

  // Collect uploaded image files
  const heroFile = form.get('hero_image');
  const heroIsFile = heroFile && typeof heroFile === 'object' && 'arrayBuffer' in heroFile && heroFile.size > 0;
  const inlineFiles = []; // [{ n: 1, file }, ...]
  for (const [key, val] of form.entries()) {
    const m = key.match(/^inline_image_(\d+)$/);
    if (m && val && typeof val === 'object' && 'arrayBuffer' in val && val.size > 0) {
      inlineFiles.push({ n: parseInt(m[1], 10), file: val });
    }
  }

  // Compose featured_image path (only if hero file provided OR existing one referenced)
  const heroImagePath = heroIsFile ? `/images/${slug}-hero.jpg` : (form.get('featured_image') || '').toString().trim();

  const meta = {
    title, subtitle, author, date, category, tags,
    featured_image: heroImagePath || undefined,
    language, show_hero: showHero, seo_description: seoDescription,
  };

  // Replace [[image:N]] placeholders in body
  const bodyResolved = replaceImagePlaceholders(body, slug, captions);
  const articleMarkdown = buildFrontmatter(meta) + '\n' + bodyResolved.replace(/\s+$/, '') + '\n';

  // Build EN stub if FI is the source (and stub doesn't already exist on dev)
  const stubMeta = {
    ...meta,
    language: 'en',
    title: `${title} [translation pending]`,
    subtitle: subtitle ? `${subtitle} [translation pending]` : undefined,
    seo_description: seoDescription ? seoDescription : undefined,
  };
  const stubBody = `*This article is not yet translated to English. The Finnish version is available at [/fi/aikakone/${slug}/](/fi/aikakone/${slug}/).*\n`;
  const stubMarkdown = buildFrontmatter(stubMeta) + '\n' + stubBody;

  // ---- Auth ----
  let token;
  try {
    const appJwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
    token = await getInstallationToken(appJwt, env.GITHUB_APP_INSTALLATION_ID);
  } catch (e) {
    return serverError(`GitHub auth failed: ${e.message}`);
  }

  // ---- Build atomic commit on dev ----
  const branch = DRAFT_BRANCH;
  const treeEntries = [];

  try {
    // 1. Article markdown
    const articleBlob = await createBlob(token, utf8ToBase64(articleMarkdown));
    treeEntries.push({
      path: `src/content/articles/${language}/${slug}.md`,
      mode: '100644', type: 'blob', sha: articleBlob.sha,
    });

    // 2. EN stub (only if FI source AND stub missing on dev)
    if (language === 'fi') {
      const stubPath = `src/content/articles/en/${slug}.md`;
      const existing = await getFileBlobSha(token, branch, stubPath);
      if (!existing) {
        const stubBlob = await createBlob(token, utf8ToBase64(stubMarkdown));
        treeEntries.push({ path: stubPath, mode: '100644', type: 'blob', sha: stubBlob.sha });
      }
    }

    // 3. Hero image (if uploaded)
    if (heroIsFile) {
      const bytes = new Uint8Array(await heroFile.arrayBuffer());
      const blob = await createBlob(token, bytesToBase64(bytes));
      treeEntries.push({
        path: `public/images/${slug}-hero.jpg`,
        mode: '100644', type: 'blob', sha: blob.sha,
      });
    }

    // 4. Inline images
    for (const { n, file } of inlineFiles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const blob = await createBlob(token, bytesToBase64(bytes));
      treeEntries.push({
        path: `public/images/${slug}-${n}.jpg`,
        mode: '100644', type: 'blob', sha: blob.sha,
      });
    }

    // 5. Commit
    const headSha   = await getBranchHead(token, branch);
    const headCommit = await getCommit(token, headSha);
    const newTree   = await createTree(token, headCommit.tree.sha, treeEntries);
    const message   = `Article: save draft "${slug}" (${language})`;
    const newCommit = await createCommit(token, message, newTree.sha, headSha);
    await updateBranch(token, branch, newCommit.sha);

    return jsonResponse({
      success: true,
      mode: 'draft',
      branch,
      slug,
      language,
      url: `https://photoandmoto-staging.pages.dev/${language}/aikakone/${slug}/`,
      committed_files: treeEntries.length,
    });
  } catch (e) {
    return serverError(`GitHub commit failed: ${e.message}`);
  }
}

// ---- Production promote: dev -> main, no re-upload ------------------------

async function handleProductionPromote({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const password = body.password || '';
  if (password !== env.UPLOAD_PASSWORD) return unauthorized();

  const mode = body.mode || 'production';
  if (mode !== 'production') return badRequest('JSON body only supports mode=production');

  const slug = sanitizeSlug(body.slug);
  const language = (body.language || 'fi').toString().trim();
  if (!slug) return badRequest('slug required');
  if (!['fi', 'en'].includes(language)) return badRequest('language must be fi or en');

  // ---- Auth ----
  let token;
  try {
    const appJwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
    token = await getInstallationToken(appJwt, env.GITHUB_APP_INSTALLATION_ID);
  } catch (e) {
    return serverError(`GitHub auth failed: ${e.message}`);
  }

  // ---- Read all relevant files from dev, copy SHAs into a main-tree ----
  const treeEntries = [];

  try {
    // 1. Primary article markdown
    const articlePath = `src/content/articles/${language}/${slug}.md`;
    const articleSha = await getFileBlobSha(token, DRAFT_BRANCH, articlePath);
    if (!articleSha) return notFound(`Draft not found on dev: ${articlePath}`);
    treeEntries.push({ path: articlePath, mode: '100644', type: 'blob', sha: articleSha });

    // 2. EN stub (if FI source). Skip silently if dev has no stub (user may have created EN directly).
    if (language === 'fi') {
      const stubPath = `src/content/articles/en/${slug}.md`;
      const stubSha = await getFileBlobSha(token, DRAFT_BRANCH, stubPath);
      if (stubSha) {
        treeEntries.push({ path: stubPath, mode: '100644', type: 'blob', sha: stubSha });
      }
    }

    // 3. All images for this slug on dev (hero + inline)
    const images = await listImagesForSlug(token, DRAFT_BRANCH, slug);
    for (const img of images) {
      treeEntries.push({ path: img.path, mode: '100644', type: 'blob', sha: img.sha });
    }

    if (treeEntries.length === 0) {
      return notFound(`No draft files found on dev for slug "${slug}"`);
    }

    // 4. Commit to main
    const headSha   = await getBranchHead(token, PROD_BRANCH);
    const headCommit = await getCommit(token, headSha);
    const newTree   = await createTree(token, headCommit.tree.sha, treeEntries);
    const message   = `Article: publish "${slug}" (${language}) to production`;
    const newCommit = await createCommit(token, message, newTree.sha, headSha);
    await updateBranch(token, PROD_BRANCH, newCommit.sha);

    return jsonResponse({
      success: true,
      mode: 'production',
      branch: PROD_BRANCH,
      slug,
      language,
      url: `https://www.photoandmoto.fi/${language}/aikakone/${slug}/`,
      promoted_files: treeEntries.length,
    });
  } catch (e) {
    return serverError(`Production promote failed: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// CORS preflight (browsers may send OPTIONS before multipart POST)
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
