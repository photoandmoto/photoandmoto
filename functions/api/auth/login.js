// functions/api/auth/login.js
//
// Email + password login. Returns a session cookie on success.
// Rate-limited (5 failed attempts per IP+email per hour, via login_attempts).
//
// Security notes:
// - Generic error message on all failures (no account enumeration)
// - Fake PBKDF2 hash on missing user to keep response times constant
// - Failed attempts logged BEFORE the generic response so rate limit works

import {
  getJsonBody,
  normalizeEmail,
  verifyPassword,
  createSession,
  getSessionCookieHeader,
  getClientIp,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
  STATIC_DECOY_HASH,
  STATIC_DECOY_SALT,
} from '../../_lib/auth.js';
import { runInit } from './init.js';

const MAX_FAILED_LOGINS_PER_HOUR = 5;
const GENERIC_LOGIN_ERROR = 'Väärä sähköposti tai salasana';

async function logAttempt(env, userId, email, ip, succeeded) {
  try {
    await env.DB.prepare(
      `INSERT INTO login_attempts (user_id, email_attempted, ip, succeeded)
       VALUES (?, ?, ?, ?)`
    ).bind(userId, email, ip, succeeded ? 1 : 0).run();
  } catch {
    // Don't let logging errors block the auth flow
  }
}

async function isRateLimited(env, email, ip) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
     WHERE succeeded = 0
       AND attempted_at > datetime('now', '-1 hour')
       AND (email_attempted = ? OR ip = ?)`
  ).bind(email, ip).first();
  return (row?.n ?? 0) >= MAX_FAILED_LOGINS_PER_HOUR;
}

export async function onRequestPost({ request, env }) {
  await runInit(env);

  const body = await getJsonBody(request);
  if (!body) return errorResponse('Virheellinen pyyntö', 400);

  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const ip = getClientIp(request);

  if (!email || !password) {
    return errorResponse(GENERIC_LOGIN_ERROR, 401);
  }

  // Rate limit check (count failed attempts in last hour for this IP or email)
  if (await isRateLimited(env, email, ip)) {
    return errorResponse(
      'Liian monta epäonnistunutta yritystä. Yritä uudelleen tunnin kuluttua.',
      429
    );
  }

  // Look up user
  const user = await env.DB.prepare(
    `SELECT id, first_name, last_name, email, role,
            perm_tarkista, perm_lahetakuva, perm_hallitse_galleriaa,
            perm_hallitse_artikkeleita, perm_admin_iam, perm_laheta_artikkeli,
            password_hash, password_salt, is_active
     FROM users WHERE email = ?`
  ).bind(email).first();

  // No user: fake hash to even out timing, log failure, return generic error
  if (!user) {
    await verifyPassword(password, STATIC_DECOY_HASH, STATIC_DECOY_SALT);
    await logAttempt(env, null, email, ip, false);
    return errorResponse(GENERIC_LOGIN_ERROR, 401);
  }

  // User exists but inactive: same generic response
  if (!user.is_active) {
    await verifyPassword(password, STATIC_DECOY_HASH, STATIC_DECOY_SALT);
    await logAttempt(env, user.id, email, ip, false);
    return errorResponse(GENERIC_LOGIN_ERROR, 401);
  }

  // User exists but password not yet set (invite not accepted)
  if (!user.password_hash || !user.password_salt) {
    await verifyPassword(password, STATIC_DECOY_HASH, STATIC_DECOY_SALT);
    await logAttempt(env, user.id, email, ip, false);
    return errorResponse(GENERIC_LOGIN_ERROR, 401);
  }

  // Verify password
  const ok = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) {
    await logAttempt(env, user.id, email, ip, false);
    return errorResponse(GENERIC_LOGIN_ERROR, 401);
  }

  // Success: create session, update last_login_at
  const { rawSessionId } = await createSession(env, user.id, request);
  await env.DB.prepare(
    `UPDATE users SET last_login_at = datetime('now') WHERE id = ?`
  ).bind(user.id).run();
  await logAttempt(env, user.id, email, ip, true);

  return jsonResponse(
    {
      success: true,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        permissions: {
          tarkista: !!user.perm_tarkista,
          lahetakuva: !!user.perm_lahetakuva,
          hallitse_galleriaa: !!user.perm_hallitse_galleriaa,
          hallitse_artikkeleita: !!user.perm_hallitse_artikkeleita,
          admin_iam: !!user.perm_admin_iam,
          laheta_artikkeli: !!user.perm_laheta_artikkeli,
        },
      },
    },
    {
      headers: { 'Set-Cookie': getSessionCookieHeader(rawSessionId) },
    }
  );
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
