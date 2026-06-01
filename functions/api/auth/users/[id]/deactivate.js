// functions/api/auth/users/[id]/deactivate.js
//
// POST /api/auth/users/:id/deactivate
//
// Admin-only. Sets is_active = 0 and destroys all sessions for the user.
// User cannot log in or use any endpoint while inactive.
//
// Protections:
//   - Cannot deactivate yourself
//   - Cannot deactivate the last active admin_iam user (would lock out
//     all admin access)
//
// Reversible: PATCH the user with is_active = true to reactivate.

import {
  requireAuth,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
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

  if (userId === auth.user.id) {
    return errorResponse('Et voi poistaa omaa tiliäsi käytöstä.', 403);
  }

  const target = await env.DB.prepare(
    `SELECT id, is_active, perm_admin_iam FROM users WHERE id = ?`
  ).bind(userId).first();

  if (!target) return errorResponse('Käyttäjää ei löytynyt', 404);

  if (!target.is_active) {
    return errorResponse('Tili on jo poistettu käytöstä.', 409);
  }

  // Last-admin protection
  if (target.perm_admin_iam) {
    const remaining = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM users
      WHERE is_active = 1 AND perm_admin_iam = 1 AND id != ?
    `).bind(userId).first();
    if ((remaining?.n ?? 0) < 1) {
      return errorResponse(
        'Vähintään yksi aktiivinen ylläpitäjä vaaditaan. Lisää toinen ylläpitäjä ennen tätä muutosta.',
        409
      );
    }
  }

  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET is_active = 0 WHERE id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
  ]);

  return jsonResponse({ success: true });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
