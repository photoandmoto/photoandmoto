// POST /api/deploy
//
// Powers the "Julkaise" tab in /fi/yllapito so non-technical editors can
// trigger a rebuild of staging for preview, and production to publish.
//
// Body:    { "target": "staging" | "production" }
// Returns: { ok: true }  or  { ok: false, error: "<finnish message>" }
//
// What each target does:
//   staging     — fires the Cloudflare Pages deploy hook for the staging
//                 project (rebuilds `dev` → photoandmoto-staging.pages.dev).
//   production  — fires the Cloudflare Pages deploy hook for the production
//                 project (rebuilds `main` → www.photoandmoto.fi).
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
//   DEPLOY_HOOK_PRODUCTION  — Cloudflare Pages deploy hook URL (production project)
//   DEPLOY_SECRET           — optional shared secret for non-browser triggers

import { requireAuth, constantTimeEqual } from '../_lib/auth.js';

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

    // 3b. Production — fire the Cloudflare deploy hook (rebuilds main → production).
    if (!env.DEPLOY_HOOK_PRODUCTION) {
      return json({ ok: false, error: 'Deploy-hookia ei ole määritetty (tuotanto)' }, 500);
    }
    const resProd = await fetch(env.DEPLOY_HOOK_PRODUCTION, { method: 'POST' });
    if (!resProd.ok) {
      return json({ ok: false, error: `Deploy-hook palautti ${resProd.status}` }, 502);
    }
    return json({ ok: true });
  } catch (err) {
    console.error('DEPLOY ENDPOINT ERROR:', err);
    return json({ ok: false, error: 'Palvelinvirhe' }, 500);
  }
}
