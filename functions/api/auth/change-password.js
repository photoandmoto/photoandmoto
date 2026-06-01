// functions/api/auth/change-password.js
//
// Logged-in user changes their own password. Requires the current password
// as proof-of-identity (defends against temporary cookie access).
//
// Does NOT destroy other sessions — this is a deliberate change by the
// authenticated user, not a recovery. If they want to log out of other
// devices, that's a separate feature for the future.

import {
  requireAuth,
  getJsonBody,
  verifyPassword,
  hashPassword,
  validatePassword,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
} from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env);
  if (auth.error) return errorResponse(auth.error, auth.status);

  const body = await getJsonBody(request);
  if (!body) return errorResponse('Virheellinen pyyntö', 400);

  const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
  const newPassword = typeof body.new_password === 'string' ? body.new_password : '';

  if (!currentPassword || !newPassword) {
    return errorResponse('Nykyinen ja uusi salasana vaaditaan', 400);
  }

  // Validate new password against policy
  const policyError = validatePassword(newPassword, {
    email: auth.user.email,
    first_name: auth.user.first_name,
    last_name: auth.user.last_name,
  });
  if (policyError) return errorResponse(policyError, 400);

  // Block trivial reuse
  if (currentPassword === newPassword) {
    return errorResponse('Uusi salasana ei voi olla sama kuin nykyinen', 400);
  }

  // Verify the current password
  const user = await env.DB.prepare(
    `SELECT password_hash, password_salt FROM users WHERE id = ?`
  ).bind(auth.user.id).first();

  if (!user || !user.password_hash) {
    return errorResponse('Tiliä ei voi muokata', 500);
  }

  const ok = await verifyPassword(currentPassword, user.password_hash, user.password_salt);
  if (!ok) {
    return errorResponse('Nykyinen salasana on väärä', 401);
  }

  // Hash + store new password
  const { hash, salt } = await hashPassword(newPassword);
  await env.DB.prepare(
    `UPDATE users
     SET password_hash = ?, password_salt = ?, password_set_at = datetime('now')
     WHERE id = ?`
  ).bind(hash, salt, auth.user.id).run();

  return jsonResponse({ success: true });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
