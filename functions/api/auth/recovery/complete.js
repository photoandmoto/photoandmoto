// functions/api/auth/recovery/complete.js
//
// Step 3 of self-service recovery: user sets a new password using the
// recovery token issued by recovery/verify. Destroys ALL existing sessions
// for the user (forced re-login everywhere). Creates a fresh session.

import {
  getJsonBody,
  sha256Hex,
  hashPassword,
  validatePassword,
  destroyAllSessionsForUser,
  createSession,
  getSessionCookieHeader,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
} from '../../../_lib/auth.js';
import { runInit } from '../init.js';

export async function onRequestPost({ request, env }) {
  await runInit(env);

  const body = await getJsonBody(request);
  if (!body) return errorResponse('Virheellinen pyyntö', 400);

  const rawToken = typeof body.recovery_token === 'string' ? body.recovery_token : '';
  const newPassword = typeof body.new_password === 'string' ? body.new_password : '';

  if (!rawToken || !newPassword) {
    return errorResponse('Recovery token ja uusi salasana vaaditaan', 400);
  }

  const tokenHash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    `SELECT t.purpose, t.expires_at, t.used_at, t.user_id,
            u.first_name, u.last_name, u.email, u.is_active
     FROM provisioning_tokens t
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.purpose = 'self_recovery'`
  ).bind(tokenHash).first();

  if (!row) return errorResponse('Recovery token on virheellinen', 410);
  if (row.used_at) return errorResponse('Recovery token on jo käytetty', 410);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return errorResponse('Recovery token on vanhentunut', 410);
  }
  if (!row.is_active) return errorResponse('Tili ei ole käytössä', 410);

  // Validate new password against policy
  const policyError = validatePassword(newPassword, {
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
  });
  if (policyError) return errorResponse(policyError, 400);

  // Hash + store
  const pw = await hashPassword(newPassword);

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_set_at = datetime('now'),
          last_recovery_at = datetime('now')
      WHERE id = ?
    `).bind(pw.hash, pw.salt, row.user_id),
    env.DB.prepare(
      `UPDATE provisioning_tokens SET used_at = datetime('now') WHERE token_hash = ?`
    ).bind(tokenHash),
  ]);

  // Destroy ALL existing sessions for this user (post-recovery hygiene)
  await destroyAllSessionsForUser(env, row.user_id);

  // Create a fresh session for the recovery-completing browser
  const { rawSessionId } = await createSession(env, row.user_id, request);

  return jsonResponse(
    { success: true },
    { headers: { 'Set-Cookie': getSessionCookieHeader(rawSessionId) } }
  );
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
