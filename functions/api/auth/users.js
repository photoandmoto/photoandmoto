// functions/api/auth/users.js
//
// Admin-only endpoints for the Käyttäjät tab.
// - GET  /api/auth/users         List all users (no hashes/tokens)
// - POST /api/auth/users         Create a new user + provisioning token

import {
  requireAuth,
  getJsonBody,
  generateToken,
  validateEmail,
  validateName,
  normalizeEmail,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
  PROVISIONING_TOKEN_TTL_SECONDS,
} from '../../_lib/auth.js';
import { runInit } from './init.js';

const VALID_ROLES = ['admin', 'editor'];
const VALID_PERMS = [
  'tarkista', 'lahetakuva', 'hallitse_galleriaa',
  'hallitse_artikkeleita', 'admin_iam',
];

function rowToUser(row) {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    role: row.role,
    permissions: {
      tarkista: !!row.perm_tarkista,
      lahetakuva: !!row.perm_lahetakuva,
      hallitse_galleriaa: !!row.perm_hallitse_galleriaa,
      hallitse_artikkeleita: !!row.perm_hallitse_artikkeleita,
      admin_iam: !!row.perm_admin_iam,
    },
    is_active: !!row.is_active,
    has_password: !!row.has_password,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    last_recovery_at: row.last_recovery_at,
  };
}

// ─── GET — list users ───────────────────────────────────────────────────────

export async function onRequestGet({ request, env }) {
  await runInit(env);

  const auth = await requireAuth(request, env, 'admin_iam');
  if (auth.error) return errorResponse(auth.error, auth.status);

  const { results } = await env.DB.prepare(`
    SELECT id, first_name, last_name, email, role,
           perm_tarkista, perm_lahetakuva, perm_hallitse_galleriaa,
           perm_hallitse_artikkeleita, perm_admin_iam,
           is_active,
           (password_hash IS NOT NULL) AS has_password,
           created_at, last_login_at, last_recovery_at
    FROM users
    ORDER BY created_at ASC
  `).all();

  return jsonResponse({
    users: (results || []).map(rowToUser),
  });
}

// ─── POST — create user + provisioning token ────────────────────────────────

export async function onRequestPost({ request, env }) {
  await runInit(env);

  const auth = await requireAuth(request, env, 'admin_iam');
  if (auth.error) return errorResponse(auth.error, auth.status);

  const body = await getJsonBody(request);
  if (!body) return errorResponse('Virheellinen pyyntö', 400);

  // ── Validate inputs ──
  const firstNameErr = validateName(body.first_name, 'Etunimi');
  if (firstNameErr) return errorResponse(firstNameErr, 400);

  const lastNameErr = validateName(body.last_name, 'Sukunimi');
  if (lastNameErr) return errorResponse(lastNameErr, 400);

  const email = normalizeEmail(body.email);
  const emailErr = validateEmail(email);
  if (emailErr) return errorResponse(emailErr, 400);

  if (!VALID_ROLES.includes(body.role)) {
    return errorResponse('Rooli on virheellinen', 400);
  }

  const perms = body.permissions || {};
  const permFlags = {};
  for (const p of VALID_PERMS) {
    permFlags[p] = perms[p] ? 1 : 0;
  }

  // ── Check email uniqueness ──
  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (existing) {
    return errorResponse('Sähköposti on jo käytössä', 409);
  }

  // ── Insert user (password_hash = NULL, security questions empty) ──
  const insert = await env.DB.prepare(`
    INSERT INTO users (
      first_name, last_name, email, role,
      perm_tarkista, perm_lahetakuva, perm_hallitse_galleriaa,
      perm_hallitse_artikkeleita, perm_admin_iam,
      created_by, is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(
    body.first_name.trim(),
    body.last_name.trim(),
    email,
    body.role,
    permFlags.tarkista, permFlags.lahetakuva, permFlags.hallitse_galleriaa,
    permFlags.hallitse_artikkeleita, permFlags.admin_iam,
    auth.user.id
  ).run();

  const userId = insert.meta.last_row_id;
  if (!userId) return errorResponse('Käyttäjän luonti epäonnistui', 500);

  // ── Generate provisioning token ──
  const { rawToken, tokenHash } = await generateToken();
  const expiresAt = new Date(Date.now() + PROVISIONING_TOKEN_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare(`
    INSERT INTO provisioning_tokens (token_hash, user_id, purpose, expires_at, created_by)
    VALUES (?, ?, 'initial_provision', ?, ?)
  `).bind(tokenHash, userId, expiresAt, auth.user.id).run();

  // ── Build the link from the request origin ──
  const url = new URL(request.url);
  const provisioningLink = `${url.protocol}//${url.host}/fi/aseta-salasana?token=${rawToken}`;

  // ── Fetch the user back for response shape consistency ──
  const userRow = await env.DB.prepare(`
    SELECT id, first_name, last_name, email, role,
           perm_tarkista, perm_lahetakuva, perm_hallitse_galleriaa,
           perm_hallitse_artikkeleita, perm_admin_iam,
           is_active,
           (password_hash IS NOT NULL) AS has_password,
           created_at, last_login_at, last_recovery_at
    FROM users WHERE id = ?
  `).bind(userId).first();

  return jsonResponse({
    success: true,
    user: rowToUser(userRow),
    provisioning_link: provisioningLink,
    expires_at: expiresAt,
  });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
