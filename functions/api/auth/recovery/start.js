// functions/api/auth/recovery/start.js
//
// Step 1 of self-service recovery: user enters their email, gets back 3
// security questions to answer.
//
// To prevent account enumeration, this endpoint ALWAYS returns 3 questions
// of the same shape — real ones if the email exists, deterministic decoys
// if it doesn't. The attacker can't tell the difference until they try to
// answer (and recovery/verify will fail equally for both cases).
//
// No rate limit here — this endpoint is read-only and idempotent. The real
// rate limit lives in recovery/verify (where each attempt costs a PBKDF2).

import {
  getJsonBody,
  normalizeEmail,
  getDecoyQuestions,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
} from '../../../_lib/auth.js';
import { runInit } from '../init.js';

export async function onRequestPost({ request, env }) {
  await runInit(env);

  const body = await getJsonBody(request);
  const email = normalizeEmail(body?.email);
  if (!email) return errorResponse('Sähköposti puuttuu', 400);

  const user = await env.DB.prepare(
    `SELECT security_q1, security_q2, security_q3, is_active, password_hash
     FROM users WHERE email = ?`
  ).bind(email).first();

  // Return decoys for missing user / inactive user / never-set-password
  if (!user || !user.is_active || !user.password_hash ||
      !user.security_q1 || !user.security_q2 || !user.security_q3) {
    const decoys = await getDecoyQuestions(email);
    return jsonResponse({
      questions: decoys,
    });
  }

  return jsonResponse({
    questions: [user.security_q1, user.security_q2, user.security_q3],
  });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
