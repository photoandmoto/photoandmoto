// functions/api/auth/seed-superadmin.js
//
// One-time bootstrap endpoint for creating the first super-admin user.
// See IAM_DESIGN.md § 8 (Migration plan, Phase D) for the operational context.
//
// Behaviour:
//   - POST → creates the super-admin user from env vars + a provisioning token.
//     Refuses if any user already exists (one-shot only). Returns the link.
//   - GET  → returns a status page explaining how to use the endpoint.
//     Does NOT mutate state. Safe to hit accidentally.
//
// Required env vars (set in Cloudflare Pages → Settings → Environment variables):
//   SUPER_ADMIN_EMAIL       — e.g. photoandmoto@gmail.com
//   SUPER_ADMIN_FIRST_NAME  — e.g. Arto
//   SUPER_ADMIN_LAST_NAME   — e.g. Vilkman
//
// Optional:
//   SUPER_ADMIN_SEED_SECRET — if set, must be passed in the request body as
//                             { seed_secret: "..." } to authorize the seed.
//                             Extra defence-in-depth in case the endpoint
//                             stays accessible after deployment.
//
// After successful seed:
//   1. The response body contains the one-time provisioning link.
//   2. The link is also logged to the Cloudflare Workers console (Real-time
//      logs → this Worker invocation).
//   3. Admin opens the link, sets password + security questions.
//   4. The endpoint self-locks (refuses further invocations since a user
//      now exists).
//   5. Admin should remove the env vars (especially SUPER_ADMIN_SEED_SECRET
//      if set) once the account is set up.

import {
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

export async function onRequestGet() {
  return jsonResponse({
    endpoint: 'seed-superadmin',
    method: 'POST',
    description: 'One-time creation of the first super-admin user. ' +
      'Requires SUPER_ADMIN_EMAIL, SUPER_ADMIN_FIRST_NAME, SUPER_ADMIN_LAST_NAME ' +
      'env vars. Refuses if any user already exists.',
    docs: 'See IAM_DESIGN.md § 8 (Migration plan, Phase D)',
  });
}

export async function onRequestPost({ request, env }) {
  try {
    // 1. Schema must exist before we can insert. Idempotent.
    await runInit(env);

    // 2. Refuse if any user already exists. This is the primary lock.
    const existing = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users`
    ).first();
    if ((existing?.n ?? 0) > 0) {
      return errorResponse(
        'Seed refused: at least one user already exists. ' +
        'To re-seed, delete all users from D1 first.',
        409
      );
    }

    // 3. Validate env vars.
    const email = normalizeEmail(env.SUPER_ADMIN_EMAIL);
    const firstName = (env.SUPER_ADMIN_FIRST_NAME || '').trim();
    const lastName = (env.SUPER_ADMIN_LAST_NAME || '').trim();

    if (!email || !firstName || !lastName) {
      return errorResponse(
        'Missing one or more required env vars: ' +
        'SUPER_ADMIN_EMAIL, SUPER_ADMIN_FIRST_NAME, SUPER_ADMIN_LAST_NAME',
        400
      );
    }

    const emailErr = validateEmail(email);
    if (emailErr) return errorResponse(`SUPER_ADMIN_EMAIL invalid: ${emailErr}`, 400);

    const firstErr = validateName(firstName, 'SUPER_ADMIN_FIRST_NAME');
    if (firstErr) return errorResponse(firstErr, 400);

    const lastErr = validateName(lastName, 'SUPER_ADMIN_LAST_NAME');
    if (lastErr) return errorResponse(lastErr, 400);

    // 4. Optional shared-secret check.
    if (env.SUPER_ADMIN_SEED_SECRET) {
      let providedSecret = null;
      try {
        const body = await request.json();
        providedSecret = body?.seed_secret;
      } catch {
        // Body might be empty/missing — that's fine, we'll fail below
      }
      if (providedSecret !== env.SUPER_ADMIN_SEED_SECRET) {
        return errorResponse(
          'Seed refused: SUPER_ADMIN_SEED_SECRET is set on the server but ' +
          'the request did not include a matching seed_secret.',
          403
        );
      }
    }

    // 5. Insert the super-admin user (all permissions = 1, role = admin).
    const insertUser = await env.DB.prepare(`
      INSERT INTO users (
        first_name, last_name, email, role,
        perm_tarkista, perm_lahetakuva, perm_hallitse_galleriaa,
        perm_hallitse_artikkeleita, perm_admin_iam,
        is_active
      )
      VALUES (?, ?, ?, 'admin', 1, 1, 1, 1, 1, 1)
    `).bind(firstName, lastName, email).run();

    const userId = insertUser.meta.last_row_id;
    if (!userId) {
      return errorResponse('Failed to insert super-admin user', 500);
    }

    // 6. Generate one-time provisioning token (for setting password +
    //    security questions on first login).
    const { rawToken, tokenHash } = await generateToken();
    const expiresAt = new Date(
      Date.now() + PROVISIONING_TOKEN_TTL_SECONDS * 1000
    ).toISOString();

    await env.DB.prepare(`
      INSERT INTO provisioning_tokens (
        token_hash, user_id, purpose, expires_at, created_by
      )
      VALUES (?, ?, 'initial_provision', ?, ?)
    `).bind(tokenHash, userId, expiresAt, userId).run();

    // 7. Build the link.
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const provisioningLink = `${origin}/fi/aseta-salasana?token=${rawToken}`;

    // 8. Log to Workers console — visible in Cloudflare Real-time logs.
    //    This is the fallback channel if the response is lost (e.g. browser
    //    closed before reading the JSON).
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SUPER-ADMIN SEED COMPLETE');
    console.log(`User: ${firstName} ${lastName} <${email}>`);
    console.log(`User ID: ${userId}`);
    console.log(`Token expires: ${expiresAt}`);
    console.log(`Provisioning link (one-time, copy now):`);
    console.log(provisioningLink);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return jsonResponse({
      success: true,
      user: {
        id: userId,
        email,
        first_name: firstName,
        last_name: lastName,
        role: 'admin',
      },
      provisioning_link: provisioningLink,
      expires_at: expiresAt,
      note: 'This link will be shown only once. The /fi/aseta-salasana page ' +
        'has not been built yet (Phase 4) — for now, this endpoint just ' +
        'confirms the schema and seeding logic work. The token is stored ' +
        'in D1 and will be usable once the page exists.',
    });
  } catch (err) {
    console.error('seed-superadmin error:', err);
    return errorResponse(err.message || 'Internal error', 500);
  }
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
