// functions/api/auth/validate-token.js
//
// Called by the /fi/aseta-salasana page on load to verify the provisioning
// token in the URL is still valid. Returns the user's name + email for the
// greeting if so.
//
// No auth required (this is the pre-auth landing).
// Returns 410 Gone if the token is expired/used/unknown (rather than 404 —
// 410 signals "this resource existed and is gone", which is exactly right).

import {
  sha256Hex,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
} from '../../_lib/auth.js';
import { runInit } from './init.js';

export async function onRequestGet({ request, env }) {
  await runInit(env);

  const url = new URL(request.url);
  const rawToken = url.searchParams.get('token');
  if (!rawToken) return errorResponse('Token puuttuu', 400);

  const tokenHash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    `SELECT t.purpose, t.expires_at, t.used_at,
            u.id AS user_id, u.first_name, u.last_name, u.email, u.is_active
     FROM provisioning_tokens t
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?`
  ).bind(tokenHash).first();

  if (!row) {
    return errorResponse('Linkki on virheellinen tai vanhentunut', 410);
  }
  if (row.used_at) {
    return errorResponse('Linkki on jo käytetty', 410);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return errorResponse('Linkki on vanhentunut', 410);
  }
  if (!row.is_active) {
    return errorResponse('Tili ei ole käytössä', 410);
  }

  return jsonResponse({
    valid: true,
    user: {
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
    },
    purpose: row.purpose,
  });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
