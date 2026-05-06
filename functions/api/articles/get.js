// GET /api/articles/get?slug=...&language=fi|en&branch=dev|main
//
// Returns one article's full content (frontmatter + body) along with the
// list of inline images that exist for that slug on the branch. Used by the
// Hallitse artikkeleita "Avaa muokattavaksi" button to load an article back
// into the Lähetä artikkeli form.
//
// Auth: UPLOAD_PASSWORD via X-Admin-Password header or ?password= query param.
//
// Response shape:
//   {
//     slug: "minicross",
//     language: "fi",
//     branch: "main",
//     path: "src/content/articles/fi/minicross.md",
//     frontmatter: { title, subtitle, author, date, category, tags[],
//                    featured_image, show_hero, seo_description, language },
//     body: "Markdown body, with /images/<slug>-<N>.jpg references replaced
//            back into [[image:N]] placeholders so the form can re-emit them
//            on save.",
//     hero_image: { path, name } | null,
//     inline_images: [
//       { num: 1, path: "public/images/<slug>-1.jpg", name: "<slug>-1.jpg",
//         caption: "..."  // pulled from the alt text in the original
//                         // ![alt](/images/<slug>-1.jpg) reference in the
//                         // saved markdown
//       },
//       ...
//     ],
//     is_stub: false
//   }

const REPO_OWNER = 'photoandmoto';
const REPO_NAME = 'photoandmoto';

// ---------------------------------------------------------------------------
// JSON helpers
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
// Base64 + JWT helpers (same auth pattern as publish.js / list.js)
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
// GitHub fetch helpers
// ---------------------------------------------------------------------------

async function fetchFileContent(token, branch, path) {
  // Returns { sha, text } for a markdown file, or null if missing.
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'photoandmoto-publisher',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub contents (${path}) failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  if (data.encoding !== 'base64' || typeof data.content !== 'string') {
    throw new Error(`Unexpected encoding for ${path}: ${data.encoding}`);
  }
  const bytes = base64ToBytes(data.content.replace(/\n/g, ''));
  return { sha: data.sha, text: new TextDecoder('utf-8').decode(bytes) };
}

async function listImagesForSlug(token, branch, slug) {
  // Lists public/images/<slug>-* files on the branch.
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/public/images?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
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
    .map(it => ({ path: it.path, name: it.name }));
}

// ---------------------------------------------------------------------------
// Frontmatter parser — same subset as list.js
// ---------------------------------------------------------------------------

function parseFrontmatterAndBody(markdown) {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: markdown };
  const block = m[1];
  const body = markdown.slice(m[0].length).replace(/^\s+/, '');
  const out = {};

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const valRaw = line.slice(colonIdx + 1).trim();

    if (!valRaw) {
      out[key] = '';
    } else if (valRaw.startsWith('"') && valRaw.endsWith('"') && valRaw.length >= 2) {
      out[key] = valRaw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (valRaw.startsWith('[') && valRaw.endsWith(']')) {
      const inner = valRaw.slice(1, -1).trim();
      if (!inner) {
        out[key] = [];
      } else {
        const parts = [];
        let cur = '', inQuote = false;
        for (let i = 0; i < inner.length; i++) {
          const c = inner[i];
          if (c === '"' && inner[i - 1] !== '\\') {
            inQuote = !inQuote;
            cur += c;
          } else if (c === ',' && !inQuote) {
            parts.push(cur);
            cur = '';
          } else {
            cur += c;
          }
        }
        if (cur.trim()) parts.push(cur);
        out[key] = parts
          .map(p => p.trim())
          .map(p => (p.startsWith('"') && p.endsWith('"')) ? p.slice(1, -1) : p)
          .filter(Boolean);
      }
    } else if (valRaw === 'true' || valRaw === 'false') {
      out[key] = valRaw === 'true';
    } else {
      out[key] = valRaw;
    }
  }

  return { frontmatter: out, body };
}

// ---------------------------------------------------------------------------
// Image-reference round-trip
// ---------------------------------------------------------------------------
// publish.js writes inline images as
//     ![alt text](/images/<slug>-N.jpg)
// On edit, we want to load the body back into the form with [[image:N]]
// placeholders so the existing image-list mechanic works. Walk the body,
// replace every /images/<slug>-N.jpg image reference with [[image:N]],
// and capture the alt text per N as the inline-image caption.

function extractImageRefs(body, slug) {
  const captions = {}; // { 1: 'alt text', 2: '...' }
  const slugRe = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('!\\[([^\\]]*)\\]\\(/images/' + slugRe + '-(\\d+)\\.(?:jpg|jpeg|png|webp)\\)', 'g');
  let rewritten = body.replace(pattern, (_, alt, num) => {
    const n = parseInt(num, 10);
    if (!captions[n]) captions[n] = (alt || '').trim();
    return '[[image:' + n + ']]';
  });
  return { rewritten, captions };
}

function detectStub(markdown) {
  return /\*This article is not yet translated to English\./i.test(markdown);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const password = request.headers.get('X-Admin-Password') || url.searchParams.get('password') || '';
  if (!env.UPLOAD_PASSWORD) return serverError('UPLOAD_PASSWORD not configured');
  if (password !== env.UPLOAD_PASSWORD) return unauthorized();

  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return serverError('GitHub App secrets missing');
  }

  const slugRaw = (url.searchParams.get('slug') || '').trim();
  if (!slugRaw) return badRequest('slug required');
  // Mirror publish.js sanitisation so callers can't reach outside articles dir
  const slug = slugRaw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) return badRequest('slug invalid');

  const language = (url.searchParams.get('language') || 'fi').toLowerCase();
  if (!['fi', 'en'].includes(language)) return badRequest('language must be fi or en');

  const branch = (url.searchParams.get('branch') || 'dev').toLowerCase();
  if (!['dev', 'main'].includes(branch)) return badRequest('branch must be dev or main');

  // ---- Auth GitHub ----
  let token;
  try {
    const appJwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
    token = await getInstallationToken(appJwt, env.GITHUB_APP_INSTALLATION_ID);
  } catch (e) {
    return serverError(`GitHub auth failed: ${e.message}`);
  }

  // ---- Fetch the article markdown ----
  const articlePath = `src/content/articles/${language}/${slug}.md`;
  let articleFile;
  try {
    articleFile = await fetchFileContent(token, branch, articlePath);
  } catch (e) {
    return serverError(`Failed to read article: ${e.message}`);
  }
  if (!articleFile) return notFound(`Article not found on ${branch}: ${articlePath}`);

  const { frontmatter, body } = parseFrontmatterAndBody(articleFile.text);

  // Convert inline image references back to [[image:N]] placeholders so the
  // form can re-emit them on save.
  const { rewritten, captions } = extractImageRefs(body, slug);

  // ---- List existing inline image files for this slug on the branch ----
  // (excludes the hero, which lives at <slug>-hero.jpg)
  let imagesOnDisk = [];
  try {
    imagesOnDisk = await listImagesForSlug(token, branch, slug);
  } catch (e) {
    return serverError(`Image listing failed: ${e.message}`);
  }

  // Hero entry, if any
  let heroImage = null;
  const heroEntry = imagesOnDisk.find(im => im.name === `${slug}-hero.jpg`);
  if (heroEntry) heroImage = { path: heroEntry.path, name: heroEntry.name };

  // Inline images: pick out <slug>-<digit>.jpg, strip the hero. Match each
  // one with the caption captured from the body alt text.
  const inlineImages = imagesOnDisk
    .map(im => {
      const m = im.name.match(/^(.+)-(\d+)\.(?:jpg|jpeg|png|webp)$/);
      if (!m) return null;
      // Make sure the prefix actually matches our slug (avoids false hits if
      // public/images/ happens to have a file like "some-other-1.jpg")
      if (m[1] !== slug) return null;
      const num = parseInt(m[2], 10);
      return { num, path: im.path, name: im.name, caption: captions[num] || '' };
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num);

  return jsonResponse({
    slug,
    language,
    branch,
    path: articlePath,
    frontmatter,
    body: rewritten,
    hero_image: heroImage,
    inline_images: inlineImages,
    is_stub: detectStub(articleFile.text),
  });
}

// ---------------------------------------------------------------------------
// CORS preflight
// ---------------------------------------------------------------------------

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Admin-Password',
    },
  });
}
