// POST /api/deploy
//
// Powers the "Julkaise" tab in /fi/yllapito so non-technical editors can
// promote content (Sveltia CMS commits article saves to the `dev` branch) to
// staging for preview, and then to production.
//
// Body:    { "target": "staging" | "production" }
// Returns: { ok: true }  or  { ok: false, error: "<finnish message>" }
//
// What each target does:
//   staging     — fires the Cloudflare Pages deploy hook for the staging
//                 project (rebuilds `dev` → photoandmoto-staging.pages.dev).
//   production  — merges `dev` → `main` via the "Photoandmoto Publisher" GitHub
//                 App (GitHub Merge API). The production Pages project watches
//                 `main`, so the merge commit auto-deploys to www. A deploy hook
//                 can NOT do this — it would only rebuild `main` as-is, without
//                 the editor's new `dev` content.
//
// Auth (defence in depth):
//   1. Same-origin check (Origin/Referer host must match this host). The
//      pm_session cookie is SameSite=Strict, so a cross-site page can't make
//      the browser send it anyway; this is belt-and-suspenders against CSRF.
//   2. requireAuth(..., 'hallitse_artikkeleita') — the REAL gate. Only a
//      logged-in editor who may manage articles can deploy. The browser sends
//      the pm_session cookie automatically on same-origin fetch.
//   3. Optional shared-secret bypass for non-browser callers (automation/curl):
//      if DEPLOY_SECRET is set AND the X-Deploy-Secret header matches, the
//      request is allowed without a session and skips the origin check. The
//      secret is NEVER sent by the browser — the yllapito page is static, so
//      embedding it would make it public. It stays a server-to-server credential.
//
// Env vars:
//   DEPLOY_HOOK_STAGING     — Cloudflare Pages deploy hook URL (staging project)
//   GITHUB_APP_ID           — Photoandmoto Publisher App id        (already set; shared with publish pipeline)
//   GITHUB_APP_INSTALLATION_ID — its installation id               (already set)
//   GITHUB_APP_PRIVATE_KEY  — its PEM private key                  (already set)
//   DEPLOY_SECRET           — optional shared secret for non-browser triggers

import { requireAuth, constantTimeEqual } from '../_lib/auth.js';

const REPO_OWNER = 'photoandmoto';
const REPO_NAME = 'photoandmoto';
const PROD_BRANCH = 'main';
const DEV_BRANCH = 'dev';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// True when the request's Origin (or Referer fallback) is the same host as the
// request URL. Rejects missing/foreign origins.
function isSameOrigin(request) {
  const host = new URL(request.url).host;
  for (const headerName of ['Origin', 'Referer']) {
    const value = request.headers.get(headerName);
    if (value) {
      try {
        return new URL(value).host === host;
      } catch {
        return false;
      }
    }
  }
  return false;
}

// ─── base64 / JWT helpers (Web Crypto, mirrors the publish pipeline) ──────────

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8ToBase64Url(str) {
  return bytesToBase64Url(new TextEncoder().encode(str));
}

// Import the App private key. Handles PKCS#8 directly and wraps PKCS#1 if needed.
async function importPrivateKey(pemString) {
  const pem = pemString
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const der = base64ToBytes(pem);
  try {
    return await crypto.subtle.importKey(
      'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    );
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
    return await crypto.subtle.importKey(
      'pkcs8', wrapped, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    );
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
  return (await res.json()).token;
}

// Merge `dev` into `main` via the GitHub Merge API. Returns a Finnish-facing
// result the handler can pass straight back.
async function promoteToProduction(env) {
  for (const k of ['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY']) {
    if (!env[k]) return { ok: false, error: `GitHub App ei ole määritetty (${k})`, status: 500 };
  }

  const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const token = await getInstallationToken(jwt, env.GITHUB_APP_INSTALLATION_ID);

  const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/merges`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'photoandmoto-publisher',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base: PROD_BRANCH,
      head: DEV_BRANCH,
      commit_message: 'Julkaise: promote dev → main (yllapito)',
    }),
  });

  if (res.status === 201) return { ok: true };               // merged → main auto-deploys
  if (res.status === 204) return { ok: true };               // already up to date — nothing to merge
  if (res.status === 409) {
    return { ok: false, error: 'Yhdistämisristiriita (dev → main) — ota yhteyttä kehittäjään', status: 409 };
  }
  const text = await res.text().catch(() => '');
  return { ok: false, error: `GitHub-yhdistäminen epäonnistui (${res.status})`, status: 502, detail: text };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 1. Authorise: server-to-server secret OR same-origin logged-in editor.
    const providedSecret = request.headers.get('X-Deploy-Secret');
    const secretOk =
      !!env.DEPLOY_SECRET && !!providedSecret && constantTimeEqual(providedSecret, env.DEPLOY_SECRET);

    if (!secretOk) {
      if (!isSameOrigin(request)) {
        return json({ ok: false, error: 'Pyyntö hylätty (väärä alkuperä)' }, 403);
      }
      const auth = await requireAuth(request, env, 'hallitse_artikkeleita');
      if (auth.error) {
        return json({ ok: false, error: auth.error }, auth.status);
      }
    }

    // 2. Validate target.
    let body = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const target = body && body.target;
    if (target !== 'staging' && target !== 'production') {
      return json(
        { ok: false, error: "Virheellinen kohde (odotettiin 'staging' tai 'production')" },
        400
      );
    }

    // 3a. Staging — fire the Cloudflare deploy hook (rebuilds dev → staging).
    if (target === 'staging') {
      if (!env.DEPLOY_HOOK_STAGING) {
        return json({ ok: false, error: 'Deploy-hookia ei ole määritetty (staging)' }, 500);
      }
      const res = await fetch(env.DEPLOY_HOOK_STAGING, { method: 'POST' });
      if (!res.ok) {
        return json({ ok: false, error: `Deploy-hook palautti ${res.status}` }, 502);
      }
      return json({ ok: true });
    }

    // 3b. Production — merge dev → main; the production project auto-deploys main.
    const result = await promoteToProduction(env);
    if (!result.ok) {
      if (result.detail) console.error('DEPLOY merge error:', result.detail);
      return json({ ok: false, error: result.error }, result.status || 502);
    }
    return json({ ok: true });
  } catch (err) {
    console.error('DEPLOY ENDPOINT ERROR:', err);
    return json({ ok: false, error: 'Palvelinvirhe' }, 500);
  }
}
