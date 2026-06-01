// functions/api/auth/recovery/verify.js
//
// Step 2 of self-service recovery: user submits their 3 answers, backend
// verifies ≥2 of 3 match. Returns a single-use recovery token on success.
//
// Rate-limited (5 attempts per IP+email per hour) — recorded in
// recovery_attempts whether succeeded or not.
//
// Same anti-enumeration discipline as recovery/start: identical timing and
// response shape regardless of whether the email exists.

import {
  getJsonBody,
  normalizeEmail,
  verifyAnswer,
  verifyPassword,
  generateToken,
  getClientIp,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
  MIN_CORRECT_ANSWERS_FOR_RECOVERY,
  RECOVERY_TOKEN_TTL_SECONDS,
  STATIC_DECOY_HASH,
  STATIC_DECOY_SALT,
} from '../../../_lib/auth.js';
import { runInit } from '../init.js';

const MAX_RECOVERY_ATTEMPTS_PER_HOUR = 5;
const GENERIC_RECOVERY_ERROR = 'Vastaukset eivät täsmää';

async function logAttempt(env, userId, email, ip, succeeded) {
  try {
    await env.DB.prepare(
      `INSERT INTO recovery_attempts (user_id, email_attempted, ip, succeeded)
       VALUES (?, ?, ?, ?)`
    ).bind(userId, email, ip, succeeded ? 1 : 0).run();
  } catch {}
}

async function isRateLimited(env, email, ip) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM recovery_attempts
     WHERE attempted_at > datetime('now', '-1 hour')
       AND (email_attempted = ? OR ip = ?)`
  ).bind(email, ip).first();
  return (row?.n ?? 0) >= MAX_RECOVERY_ATTEMPTS_PER_HOUR;
}

export async function onRequestPost({ request, env }) {
  await runInit(env);

  const body = await getJsonBody(request);
  if (!body) return errorResponse('Virheellinen pyyntö', 400);

  const email = normalizeEmail(body.email);
  const answers = Array.isArray(body.answers) ? body.answers : null;
  const ip = getClientIp(request);

  if (!email || !answers || answers.length !== 3) {
    return errorResponse(GENERIC_RECOVERY_ERROR, 401);
  }

  if (await isRateLimited(env, email, ip)) {
    return errorResponse(
      'Liian monta yritystä. Yritä uudelleen tunnin kuluttua tai ota yhteyttä ylläpitäjään.',
      429
    );
  }

  const user = await env.DB.prepare(
    `SELECT id, is_active, password_hash,
            security_a1_hash, security_a1_salt,
            security_a2_hash, security_a2_salt,
            security_a3_hash, security_a3_salt
     FROM users WHERE email = ?`
  ).bind(email).first();

  // Non-existent / inactive / never-set: ONE fake PBKDF2 to even timing, log fail.
  // (Real-user path also does a single PBKDF2 average — most users get the first
  // answer right, and verifyAnswer short-circuits on mismatch in constant-time.)
  if (!user || !user.is_active || !user.password_hash ||
      !user.security_a1_hash || !user.security_a2_hash || !user.security_a3_hash) {
    await verifyPassword(
      typeof answers[0] === 'string' ? answers[0] : 'x',
      STATIC_DECOY_HASH, STATIC_DECOY_SALT
    );
    await logAttempt(env, user?.id || null, email, ip, false);
    return errorResponse(GENERIC_RECOVERY_ERROR, 401);
  }

  // Verify each non-empty answer
  let correct = 0;
  const a1 = typeof answers[0] === 'string' ? answers[0] : '';
  const a2 = typeof answers[1] === 'string' ? answers[1] : '';
  const a3 = typeof answers[2] === 'string' ? answers[2] : '';

  if (a1 && await verifyAnswer(a1, user.security_a1_hash, user.security_a1_salt)) correct++;
  if (a2 && await verifyAnswer(a2, user.security_a2_hash, user.security_a2_salt)) correct++;
  if (a3 && await verifyAnswer(a3, user.security_a3_hash, user.security_a3_salt)) correct++;

  if (correct < MIN_CORRECT_ANSWERS_FOR_RECOVERY) {
    await logAttempt(env, user.id, email, ip, false);
    return errorResponse(GENERIC_RECOVERY_ERROR, 401);
  }

  // Issue a short-lived single-use recovery token (purpose='self_recovery')
  const { rawToken, tokenHash } = await generateToken();
  const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare(`
    INSERT INTO provisioning_tokens (token_hash, user_id, purpose, expires_at)
    VALUES (?, ?, 'self_recovery', ?)
  `).bind(tokenHash, user.id, expiresAt).run();

  await logAttempt(env, user.id, email, ip, true);

  return jsonResponse({
    success: true,
    recovery_token: rawToken,
    expires_at: expiresAt,
  });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
