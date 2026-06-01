// functions/api/auth/users/[id]/regenerate-link.js
//
// POST /api/auth/users/:id/regenerate-link
//
// Admin-only. Forgot-password fallback (Option 1 in IAM_DESIGN.md § 6.6).
// Wipes the user's password + security questions, invalidates any unused
// existing tokens, destroys all sessions, and issues a new provisioning
// link as if from scratch.
//
// Use cases:
//   - User forgot both their password AND their security question answers
//   - Provisioning link expired (>48h) and was never used
//   - Suspected account compromise — admin wants to reset the user

import {
  requireAuth,
  generateToken,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
  PROVISIONING_TOKEN_TTL_SECONDS,
} from '../../../../_lib/auth.js';
import { runInit } from '../../init.js';

export async function onRequestPost({ request, env, params }) {
  await runInit(env);

  const auth = await requireAuth(request, env, 'admin_iam');
  if (auth.error) return errorResponse(auth.error, auth.status);

  const userId = Number(params.id);
  if (!userId || Number.isNaN(userId)) {
    return errorResponse('Virheellinen käyttäjän ID', 400);
  }

  const target = await env.DB.prepare(
    `SELECT id, is_active FROM users WHERE id = ?`
  ).bind(userId).first();

  if (!target) return errorResponse('Käyttäjää ei löytynyt', 404);
  if (!target.is_active) {
    return errorResponse(
      'Tili ei ole käytössä. Aktivoi se ensin ennen uuden linkin luomista.',
      409
    );
  }

  // Generate the new token first (so any failure leaves state untouched)
  const { rawToken, tokenHash } = await generateToken();
  const expiresAt = new Date(Date.now() + PROVISIONING_TOKEN_TTL_SECONDS * 1000).toISOString();

  // Atomic reset: invalidate old tokens, wipe credentials, insert new token, kill sessions
  await env.DB.batch([
    // Mark any unused tokens for this user as used (consumed without effect)
    env.DB.prepare(`
      UPDATE provisioning_tokens
      SET used_at = datetime('now')
      WHERE user_id = ? AND used_at IS NULL
    `).bind(userId),
    // Wipe password + security questions
    env.DB.prepare(`
      UPDATE users SET
        password_hash = NULL, password_salt = NULL, password_set_at = NULL,
        security_q1 = NULL, security_a1_hash = NULL, security_a1_salt = NULL,
        security_q2 = NULL, security_a2_hash = NULL, security_a2_salt = NULL,
        security_q3 = NULL, security_a3_hash = NULL, security_a3_salt = NULL
      WHERE id = ?
    `).bind(userId),
    // Insert new admin_reset token
    env.DB.prepare(`
      INSERT INTO provisioning_tokens (token_hash, user_id, purpose, expires_at, created_by)
      VALUES (?, ?, 'admin_reset', ?, ?)
    `).bind(tokenHash, userId, expiresAt, auth.user.id),
    // Destroy all sessions for this user
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
  ]);

  const url = new URL(request.url);
  const provisioningLink = `${url.protocol}//${url.host}/fi/aseta-salasana?token=${rawToken}`;

  return jsonResponse({
    success: true,
    provisioning_link: provisioningLink,
    expires_at: expiresAt,
  });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
