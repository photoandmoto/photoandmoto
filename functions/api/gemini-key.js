// GET /api/gemini-key
//
// Returns the Gemini API key to a logged-in editor so they can paste it into
// Sveltia's translation settings. The key lives ONLY in the Cloudflare env var
// GEMINI_API_KEY — it is never in the static site or git. Access is gated by the
// pm_session cookie via requireAuth (perm: hallitse_artikkeleita), and the
// response is no-store so it isn't cached.

import { requireAuth, jsonResponse, errorResponse, corsOptionsResponse } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env, 'hallitse_artikkeleita');
  if (auth.error) return errorResponse(auth.error, auth.status);

  if (!env.GEMINI_API_KEY) {
    return errorResponse('Gemini-avainta ei ole määritetty palvelimella', 500);
  }

  return jsonResponse({ key: env.GEMINI_API_KEY }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
