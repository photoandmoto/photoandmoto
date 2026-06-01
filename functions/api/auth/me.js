// functions/api/auth/me.js
//
// Returns the current user + their permissions. Used by the frontend to
// decide which tabs to show.
// 401 if no valid session.

import { requireAuth, jsonResponse, errorResponse, corsOptionsResponse } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);
  if (auth.error) return errorResponse(auth.error, auth.status);

  return jsonResponse({ user: auth.user });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
