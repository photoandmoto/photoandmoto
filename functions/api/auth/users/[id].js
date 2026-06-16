// functions/api/auth/users/[id].js
//
// PATCH /api/auth/users/:id  — admin updates user metadata + permissions
//
// Allowed fields: first_name, last_name, role, permissions (any subset),
// is_active. Cannot change email (would invalidate provisioning links).
//
// Protections:
//   - Cannot demote yourself out of admin_iam (use a different admin)
//   - Cannot deactivate yourself
//   - Cannot remove admin_iam from the last active admin_iam user
//   - Cannot deactivate the last active admin_iam user

import {
  requireAuth,
  getJsonBody,
  validateName,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
} from '../../../_lib/auth.js';
import { runInit } from '../init.js';

const VALID_ROLES = ['admin', 'editor'];
const VALID_PERMS = [
  'tarkista', 'lahetakuva', 'hallitse_galleriaa',
  'hallitse_artikkeleita', 'admin_iam', 'laheta_artikkeli',
];

async function countActiveAdmins(env, excludingUserId = null) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS n FROM users
    WHERE is_active = 1 AND perm_admin_iam = 1
    ${excludingUserId ? 'AND id != ?' : ''}
  `).bind(...(excludingUserId ? [excludingUserId] : [])).first();
  return row?.n ?? 0;
}

export async function onRequestPatch({ request, env, params }) {
  await runInit(env);

  const auth = await requireAuth(request, env, 'admin_iam');
  if (auth.error) return errorResponse(auth.error, auth.status);

  const userId = Number(params.id);
  if (!userId || Number.isNaN(userId)) {
    return errorResponse('Virheellinen käyttäjän ID', 400);
  }

  const target = await env.DB.prepare(
    `SELECT id, first_name, last_name, role,
            perm_tarkista, perm_lahetakuva, perm_hallitse_galleriaa,
            perm_hallitse_artikkeleita, perm_admin_iam, perm_laheta_artikkeli,
            is_active
     FROM users WHERE id = ?`
  ).bind(userId).first();

  if (!target) return errorResponse('Käyttäjää ei löytynyt', 404);

  const body = await getJsonBody(request);
  if (!body) return errorResponse('Virheellinen pyyntö', 400);

  const isSelf = userId === auth.user.id;

  // Compute the merged state — what the user would look like after the patch
  const merged = {
    first_name: body.first_name !== undefined ? String(body.first_name).trim() : target.first_name,
    last_name: body.last_name !== undefined ? String(body.last_name).trim() : target.last_name,
    role: body.role !== undefined ? body.role : target.role,
    perm_tarkista: body.permissions?.tarkista !== undefined
      ? (body.permissions.tarkista ? 1 : 0) : target.perm_tarkista,
    perm_lahetakuva: body.permissions?.lahetakuva !== undefined
      ? (body.permissions.lahetakuva ? 1 : 0) : target.perm_lahetakuva,
    perm_hallitse_galleriaa: body.permissions?.hallitse_galleriaa !== undefined
      ? (body.permissions.hallitse_galleriaa ? 1 : 0) : target.perm_hallitse_galleriaa,
    perm_hallitse_artikkeleita: body.permissions?.hallitse_artikkeleita !== undefined
      ? (body.permissions.hallitse_artikkeleita ? 1 : 0) : target.perm_hallitse_artikkeleita,
    perm_admin_iam: body.permissions?.admin_iam !== undefined
      ? (body.permissions.admin_iam ? 1 : 0) : target.perm_admin_iam,
    perm_laheta_artikkeli: body.permissions?.laheta_artikkeli !== undefined
      ? (body.permissions.laheta_artikkeli ? 1 : 0) : target.perm_laheta_artikkeli,
    is_active: body.is_active !== undefined
      ? (body.is_active ? 1 : 0) : target.is_active,
  };

  // ── Validate the merged state ──
  const firstErr = validateName(merged.first_name, 'Etunimi');
  if (firstErr) return errorResponse(firstErr, 400);

  const lastErr = validateName(merged.last_name, 'Sukunimi');
  if (lastErr) return errorResponse(lastErr, 400);

  if (!VALID_ROLES.includes(merged.role)) {
    return errorResponse('Rooli on virheellinen', 400);
  }

  // ── Self-protection: can't demote / deactivate yourself ──
  if (isSelf && merged.perm_admin_iam === 0 && target.perm_admin_iam === 1) {
    return errorResponse(
      'Et voi poistaa omia ylläpitäjän oikeuksiasi. Pyydä toista ylläpitäjää tekemään se.',
      403
    );
  }
  if (isSelf && merged.is_active === 0 && target.is_active === 1) {
    return errorResponse(
      'Et voi poistaa omaa tiliäsi käytöstä.',
      403
    );
  }

  // ── Last-admin protection ──
  const losingAdminIam = target.perm_admin_iam === 1 && merged.perm_admin_iam === 0;
  const beingDeactivated = target.is_active === 1 && merged.is_active === 0;
  if (losingAdminIam || beingDeactivated) {
    const remaining = await countActiveAdmins(env, userId);
    if (remaining < 1) {
      return errorResponse(
        'Vähintään yksi aktiivinen ylläpitäjä vaaditaan. Lisää toinen ylläpitäjä ennen tätä muutosta.',
        409
      );
    }
  }

  // ── Apply the update ──
  await env.DB.prepare(`
    UPDATE users SET
      first_name = ?, last_name = ?, role = ?,
      perm_tarkista = ?, perm_lahetakuva = ?,
      perm_hallitse_galleriaa = ?, perm_hallitse_artikkeleita = ?,
      perm_admin_iam = ?, perm_laheta_artikkeli = ?,
      is_active = ?
    WHERE id = ?
  `).bind(
    merged.first_name, merged.last_name, merged.role,
    merged.perm_tarkista, merged.perm_lahetakuva,
    merged.perm_hallitse_galleriaa, merged.perm_hallitse_artikkeleita,
    merged.perm_admin_iam, merged.perm_laheta_artikkeli,
    merged.is_active,
    userId
  ).run();

  // ── If deactivated, destroy their sessions ──
  if (beingDeactivated) {
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
  }

  // ── Return the updated user ──
  const updated = await env.DB.prepare(`
    SELECT id, first_name, last_name, email, role,
           perm_tarkista, perm_lahetakuva, perm_hallitse_galleriaa,
           perm_hallitse_artikkeleita, perm_admin_iam, perm_laheta_artikkeli,
           is_active,
           (password_hash IS NOT NULL) AS has_password,
           created_at, last_login_at, last_recovery_at
    FROM users WHERE id = ?
  `).bind(userId).first();

  return jsonResponse({
    success: true,
    user: {
      id: updated.id,
      first_name: updated.first_name,
      last_name: updated.last_name,
      email: updated.email,
      role: updated.role,
      permissions: {
        tarkista: !!updated.perm_tarkista,
        lahetakuva: !!updated.perm_lahetakuva,
        hallitse_galleriaa: !!updated.perm_hallitse_galleriaa,
        hallitse_artikkeleita: !!updated.perm_hallitse_artikkeleita,
        admin_iam: !!updated.perm_admin_iam,
        laheta_artikkeli: !!updated.perm_laheta_artikkeli,
      },
      is_active: !!updated.is_active,
      has_password: !!updated.has_password,
      created_at: updated.created_at,
      last_login_at: updated.last_login_at,
      last_recovery_at: updated.last_recovery_at,
    },
  });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
