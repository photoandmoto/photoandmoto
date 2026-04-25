// functions/api/mystery/galleries.js
//
// Returns the list of available galleries for the publish dropdown.
// Auto-discovers galleries by listing src/content/galleries/*.json in the
// current branch (dev on staging, main on production), reading each manifest's
// `title` field, and returning a sorted list. This keeps the dropdown in sync
// with whatever exists in the repo — including galleries created via earlier
// publish flows.
//
// Auth: requires admin password (passed via header X-Admin-Password OR ?password= query).
//
// Caching: the GitHub Contents API call is cached for 60 seconds per branch
// using the Cloudflare Workers `caches.default` API. This keeps the dropdown
// fast (it's opened many times during admin sessions) while still picking up
// newly created galleries within ~1 minute.

const ALLOWED_BRANCHES = new Set(['dev', 'main']);

export async function onRequestGet(context) {
  return handleRequest(context);
}

export async function onRequestPost(context) {
  return handleRequest(context);
}

async function handleRequest(context) {
  const { request, env } = context;

  // ---- Auth check ----
  const url = new URL(request.url);
  const headerPw = request.headers.get('X-Admin-Password') || '';
  const queryPw = url.searchParams.get('password') || '';
  const submitted = headerPw || queryPw;

  if (!env.UPLOAD_PASSWORD || submitted !== env.UPLOAD_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // ---- Determine branch ----
  // CF_PAGES_BRANCH is set automatically by Cloudflare Pages.
  const branch = (env.CF_PAGES_BRANCH === 'main') ? 'main' : 'dev';
  if (!ALLOWED_BRANCHES.has(branch)) {
    return json({ error: 'Invalid branch context' }, 500);
  }

  // ---- Auth requires GitHub App credentials too (same as publish endpoint) ----
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return json({ error: 'GitHub App credentials not configured' }, 500);
  }

  // ---- Try cache first (60s TTL per branch) ----
  // Use a synthetic cache key URL — the request URL would include ?password=
  // which we don't want as part of the cache key.
  const cacheKey = new Request(`https://galleries-cache.internal/${branch}`, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    // Return the cached body but with this request's headers
    const body = await cached.text();
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
    });
  }

  // ---- Fetch the manifests directory listing from GitHub ----
  let token;
  try {
    token = await getInstallationToken(env);
  } catch (e) {
    return json({ error: 'GitHub auth failed: ' + e.message }, 500);
  }

  const owner = 'photoandmoto';
  const repo = 'photoandmoto';
  const dirPath = 'src/content/galleries';

  let dirItems;
  try {
    const listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
    const r = await fetch(listUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'photoandmoto-publisher',
      },
    });
    if (!r.ok) {
      const text = await r.text();
      return json({ error: `GitHub list failed: ${r.status} ${text}` }, 502);
    }
    dirItems = await r.json();
  } catch (e) {
    return json({ error: 'GitHub list error: ' + e.message }, 502);
  }

  // ---- Filter to .json manifests, fetch each, extract title ----
  const manifestFiles = (Array.isArray(dirItems) ? dirItems : [])
    .filter(f => f.type === 'file' && f.name.endsWith('.json'));

  // Fetch all manifests in parallel — small list (<20 typically), fine.
  const galleries = await Promise.all(manifestFiles.map(async (f) => {
    const slug = f.name.replace(/\.json$/, '');
    let title = formatTitleFromSlug(slug); // fallback if download fails or title is missing

    try {
      // f.download_url is the raw file URL — no auth required, but it's GitHub-hosted
      // and file is in our private/public repo. For our public repo this works.
      // For safety we fetch via the API with auth instead.
      const blobUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}/${f.name}?ref=${branch}`;
      const r = await fetch(blobUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'photoandmoto-publisher',
        },
      });
      if (r.ok) {
        const meta = await r.json();
        // Content is base64; decode and parse
        const decoded = atob((meta.content || '').replace(/\n/g, ''));
        const manifest = JSON.parse(decoded);
        if (manifest && typeof manifest.title === 'string' && manifest.title.trim()) {
          title = manifest.title.trim();
        }
      }
    } catch {
      // keep fallback title
    }

    return { slug, title };
  }));

  // Sort alphabetically by title
  galleries.sort((a, b) => a.title.localeCompare(b.title, 'fi'));

  // ---- Cache result for 60s and return ----
  const responseBody = JSON.stringify({ galleries });
  const cacheableResponse = new Response(responseBody, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  });
  // Store in cache (clone — body can only be read once)
  await cache.put(cacheKey, cacheableResponse.clone());

  return new Response(responseBody, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
  });
}

// ---- Helpers ----

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Format slug → display title (fallback only; manifest's title is preferred)
function formatTitleFromSlug(slug) {
  const roman = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']);
  return slug.split('-').map(w => {
    if (roman.has(w.toLowerCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

// =============================================================================
// GitHub App auth (same logic as publish endpoint — keep in sync)
// =============================================================================

async function getInstallationToken(env) {
  const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const r = await fetch(
    `https://api.github.com/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'photoandmoto-publisher',
      },
    }
  );
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`installation token request failed: ${r.status} ${text}`);
  }
  const data = await r.json();
  return data.token;
}

async function signAppJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: String(appId),
  };
  const encHeader = b64urlEncodeJson(header);
  const encPayload = b64urlEncodeJson(payload);
  const signingInput = `${encHeader}.${encPayload}`;

  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  const encSig = b64urlEncode(new Uint8Array(sig));
  return `${signingInput}.${encSig}`;
}

async function importPrivateKey(pem) {
  const cleaned = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const der = base64ToBytes(cleaned);

  // Detect format: PKCS#8 starts with 0x30 0x82 ... 0x02 0x01 0x00 (version 0)
  // PKCS#1 starts with 0x30 0x82 ... 0x02 0x01 0x00 0x02 0x82 (version + n)
  // Heuristic: try PKCS#8 first, if that fails wrap as PKCS#8 from PKCS#1
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    const wrapped = wrapPkcs1AsPkcs8(der);
    return await crypto.subtle.importKey(
      'pkcs8',
      wrapped,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }
}

// Wrap a PKCS#1 RSAPrivateKey blob into a PKCS#8 PrivateKeyInfo structure.
// PKCS#8 = SEQUENCE { version INTEGER (0), algorithm AlgorithmIdentifier, privateKey OCTET STRING }
// AlgorithmIdentifier for RSA: SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }
function wrapPkcs1AsPkcs8(pkcs1) {
  // Pre-built header: SEQUENCE wrapper for { version=0, algId=rsaEncryption+NULL, privateKey=OCTET STRING }
  // We'll construct it dynamically because length depends on pkcs1 size.
  const rsaOid = new Uint8Array([
    0x30, 0x0d,             // SEQUENCE, len 13
    0x06, 0x09,             // OID, len 9
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // 1.2.840.113549.1.1.1
    0x05, 0x00,             // NULL
  ]);
  const version = new Uint8Array([0x02, 0x01, 0x00]); // INTEGER 0

  // OCTET STRING wrapping pkcs1
  const octetHeader = derLengthHeader(0x04, pkcs1.length);
  const octetString = concat(octetHeader, pkcs1);

  // Inner contents = version + rsaOid + octetString
  const inner = concat(version, rsaOid, octetString);

  // Outer SEQUENCE
  const outerHeader = derLengthHeader(0x30, inner.length);
  return concat(outerHeader, inner);
}

function derLengthHeader(tag, len) {
  if (len < 128) return new Uint8Array([tag, len]);
  if (len < 256) return new Uint8Array([tag, 0x81, len]);
  if (len < 65536) return new Uint8Array([tag, 0x82, (len >> 8) & 0xff, len & 0xff]);
  return new Uint8Array([tag, 0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncodeJson(obj) {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}
