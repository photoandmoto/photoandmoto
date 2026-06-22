// functions/api/auth/accept-invite.js
//
// Editor accepts their provisioning link: sets password + 3 security
// questions in one atomic step. Creates a session on success.
//
// No auth required (the token IS the auth).
// Single-use: token is marked `used_at` and cannot be replayed.

import {
  getJsonBody,
  sha256Hex,
  hashPassword,
  hashAnswer,
  validatePassword,
  validateSecurityQuestion,
  validateSecurityAnswer,
  createSession,
  getSessionCookieHeader,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
} from '../../_lib/auth.js';
import { runInit } from './init.js';

export async function onRequestPost({ request, env }) {
  await runInit(env);

  const body = await getJsonBody(request);
  if (!body) return errorResponse('Virheellinen pyyntö', 400);

  const rawToken = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const sqRaw = Array.isArray(body.security_questions) ? body.security_questions : null;

  if (!rawToken || !password || !sqRaw || sqRaw.length !== 3) {
    return errorResponse('Token, salasana ja kolme turvakysymystä vaaditaan', 400);
  }

  // Validate each question/answer pair
  for (let i = 0; i < 3; i++) {
    const item = sqRaw[i] || {};
    const qErr = validateSecurityQuestion(item.question);
    if (qErr) return errorResponse(`Kysymys ${i + 1}: ${qErr}`, 400);
    const aErr = validateSecurityAnswer(item.answer);
    if (aErr) return errorResponse(`Vastaus ${i + 1}: ${aErr}`, 400);
  }

  // Look up token
  const tokenHash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    `SELECT t.purpose, t.expires_at, t.used_at, t.user_id,
            u.first_name, u.last_name, u.email, u.is_active
     FROM provisioning_tokens t
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?`
  ).bind(tokenHash).first();

  if (!row) return errorResponse('Linkki on virheellinen tai vanhentunut', 410);
  if (row.used_at) return errorResponse('Linkki on jo käytetty', 410);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return errorResponse('Linkki on vanhentunut', 410);
  }
  if (!row.is_active) return errorResponse('Tili ei ole käytössä', 410);

  // Validate password against policy (now that we know the user context)
  const policyError = validatePassword(password, {
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
  });
  if (policyError) return errorResponse(policyError, 400);

  // Hash password + each answer
  const pw = await hashPassword(password);
  const a1 = await hashAnswer(sqRaw[0].answer);
  const a2 = await hashAnswer(sqRaw[1].answer);
  const a3 = await hashAnswer(sqRaw[2].answer);

  // Atomic update: set credentials + mark token used
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users SET
        password_hash = ?, password_salt = ?, password_set_at = datetime('now'),
        security_q1 = ?, security_a1_hash = ?, security_a1_salt = ?,
        security_q2 = ?, security_a2_hash = ?, security_a2_salt = ?,
        security_q3 = ?, security_a3_hash = ?, security_a3_salt = ?
      WHERE id = ?
    `).bind(
      pw.hash, pw.salt,
      sqRaw[0].question.trim(), a1.hash, a1.salt,
      sqRaw[1].question.trim(), a2.hash, a2.salt,
      sqRaw[2].question.trim(), a3.hash, a3.salt,
      row.user_id
    ),
    env.DB.prepare(
      `UPDATE provisioning_tokens SET used_at = datetime('now') WHERE token_hash = ?`
    ).bind(tokenHash),
  ]);

  // Fetch the now-updated user (for the response)
  const user = await env.DB.prepare(
    `SELECT id, first_name, last_name, email, role,
            perm_tarkista, perm_lahetakuva, perm_hallitse_galleriaa,
            perm_hallitse_artikkeleita, perm_admin_iam, perm_laheta_artikkeli,
            perm_nahta_gemini_avain
     FROM users WHERE id = ?`
  ).bind(row.user_id).first();

  // Create session
  const { rawSessionId } = await createSession(env, user.id, request);
  await env.DB.prepare(
    `UPDATE users SET last_login_at = datetime('now') WHERE id = ?`
  ).bind(user.id).run();

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
          nahta_gemini_avain: !!user.perm_nahta_gemini_avain,
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
