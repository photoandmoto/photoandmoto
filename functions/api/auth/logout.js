// functions/api/auth/logout.js
//
// Destroys the current session and clears the cookie.
// Idempotent — calling without a session still returns 200.

import {
  getCookie,
  destroySession,
  getClearSessionCookieHeader,
  jsonResponse,
  corsOptionsResponse,
  SESSION_COOKIE_NAME,
} from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const rawSessionId = getCookie(request, SESSION_COOKIE_NAME);
  if (rawSessionId) {
    await destroySession(env, rawSessionId);
  }
  return jsonResponse(
    { success: true },
    { headers: { 'Set-Cookie': getClearSessionCookieHeader() } }
  );
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
