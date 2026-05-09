// GET /api/articles/list[?branch=main|dev]
//
// Returns an array of article metadata for the given branch (default: main).
// Used by the Hallitse artikkeleita admin tab.
//
// Auth: UPLOAD_PASSWORD via X-Admin-Password header or ?password= query param.
//       (Header preferred; query param accepted as fallback.)
//
// Response shape:
//   {
//     branch: "main" | "dev",
//     count: 18,
//     articles: [
//       {
//         slug: "minicross",
//         language: "fi",
//         path: "src/content/articles/fi/minicross.md",
//         title: "...",
//         subtitle: "...",
//         date: "2026-03-01",
//         category: "Historical",
//         tags: ["..."],
//         featured_image: "/images/...",
//         author: "...",
//         is_stub: false,           // true if this is an auto-generated EN translation-pending stub
//       },
//       ...
//     ]
//   }
//
// Articles are returned sorted by date descending (newest first).

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
function serverError(msg)  { return jsonResponse({ error: msg || 'Server error' }, 500); }

// ---------------------------------------------------------------------------
// Base64 + JWT helpers (lifted from publish.js — same auth pattern)
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
// GitHub helpers — list directory + fetch file content
// ---------------------------------------------------------------------------

async function listDirectory(token, branch, path) {
  // Returns array of { name, path, sha, size, type, download_url } for files in path.
  // 404 if path doesn't exist.
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${encodeURIComponent(branch)}`;
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
    throw new Error(`GitHub list ${path} failed (${res.status}): ${text}`);
  }
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

async function fetchBlobAsText(token, blobSha) {
  // git/blobs returns base64 content; decode to UTF-8 string.
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs/${blobSha}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'photoandmoto-publisher',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub blob ${blobSha} failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  if (data.encoding !== 'base64') {
    throw new Error(`Unexpected blob encoding: ${data.encoding}`);
  }
  // Decode base64 -> bytes -> UTF-8 string
  const bytes = base64ToBytes(data.content.replace(/\n/g, ''));
  return new TextDecoder('utf-8').decode(bytes);
}

// ---------------------------------------------------------------------------
// Frontmatter parser — only what we need for the list view
// ---------------------------------------------------------------------------
// Not a full YAML parser — articles use a small known subset:
//   key: "double-quoted string"
//   key: bare-value
//   key: ["arr", "of", "strings"]
//   key: true | false
// Anything weirder, we skip.

function parseFrontmatter(markdown) {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const block = m[1];
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
      // Simple array: ["a", "b", "c"]
      const inner = valRaw.slice(1, -1).trim();
      if (!inner) {
        out[key] = [];
      } else {
        // Split on commas not inside quotes — naive, fine for our schema
        const parts = [];
        let cur = '';
        let inQuote = false;
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

  return out;
}

function detectStub(markdown) {
  // EN stubs auto-generated by publish.js have this exact marker line
  return /\*This article is not yet translated to English\./i.test(markdown);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  // Auth: header preferred, query fallback
  const password = request.headers.get('X-Admin-Password') || url.searchParams.get('password') || '';
  if (!env.UPLOAD_PASSWORD) return serverError('UPLOAD_PASSWORD not configured');
  if (password !== env.UPLOAD_PASSWORD) return unauthorized();

  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return serverError('GitHub App secrets missing');
  }

  const branchParam = (url.searchParams.get('branch') || 'main').toLowerCase();
  if (!['main', 'dev'].includes(branchParam)) return badRequest('branch must be main or dev');

  // ---- Auth ----
  let token;
  try {
    const appJwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
    token = await getInstallationToken(appJwt, env.GITHUB_APP_INSTALLATION_ID);
  } catch (e) {
    return serverError(`GitHub auth failed: ${e.message}`);
  }

  // ---- List FI + EN article directories in parallel ----
  let fiList, enList;
  try {
    [fiList, enList] = await Promise.all([
      listDirectory(token, branchParam, 'src/content/articles/fi'),
      listDirectory(token, branchParam, 'src/content/articles/en'),
    ]);
  } catch (e) {
    return serverError(`GitHub directory list failed: ${e.message}`);
  }

  // Filter to .md files only, attach language
  const fileEntries = [
    ...fiList.filter(f => f.type === 'file' && f.name.endsWith('.md')).map(f => ({ ...f, language: 'fi' })),
    ...enList.filter(f => f.type === 'file' && f.name.endsWith('.md')).map(f => ({ ...f, language: 'en' })),
  ];

  // ---- Fetch all blobs in parallel and parse frontmatter ----
  let articles;
  try {
    articles = await Promise.all(
      fileEntries.map(async (entry) => {
        const text = await fetchBlobAsText(token, entry.sha);
        const fm = parseFrontmatter(text);
        return {
          slug: entry.name.replace(/\.md$/, ''),
          language: entry.language,
          path: entry.path,
          title: fm.title || '',
          subtitle: fm.subtitle || '',
          date: fm.date || '',
          category: fm.category || '',
          tags: Array.isArray(fm.tags) ? fm.tags : [],
          featured_image: fm.featured_image || '',
          author: fm.author || '',
          is_stub: detectStub(text),
        };
      })
    );
  } catch (e) {
    return serverError(`Failed to read article files: ${e.message}`);
  }

  // ---- Sort by date descending (newest first); fall back to slug for ties ----
  articles.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.slug < b.slug ? -1 : 1;
  });

  return jsonResponse({
    branch: branchParam,
    count: articles.length,
    articles,
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
