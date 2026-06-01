// functions/api/auth/audit/recoveries.js
//
// GET /api/auth/audit/recoveries
//
// Admin-only. Lists recent recovery_attempts joined with users, for the
// Käyttäjät tab's audit view. Default: last 50 events.

import {
  requireAuth,
  jsonResponse,
  errorResponse,
  corsOptionsResponse,
} from '../../../_lib/auth.js';
import { runInit } from '../init.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function onRequestGet({ request, env }) {
  await runInit(env);

  const auth = await requireAuth(request, env, 'admin_iam');
  if (auth.error) return errorResponse(auth.error, auth.status);

  const url = new URL(request.url);
  let limit = Number(url.searchParams.get('limit')) || DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const { results } = await env.DB.prepare(`
    SELECT
      r.id, r.user_id, r.email_attempted, r.ip,
      r.succeeded, r.attempted_at,
      u.first_name, u.last_name, u.email
    FROM recovery_attempts r
    LEFT JOIN users u ON u.id = r.user_id
    ORDER BY r.attempted_at DESC
    LIMIT ?
  `).bind(limit).all();

  return jsonResponse({
    attempts: (results || []).map(row => ({
      id: row.id,
      user_id: row.user_id,
      user_first_name: row.first_name,
      user_last_name: row.last_name,
      user_email: row.email,
      email_attempted: row.email_attempted,
      ip: row.ip,
      succeeded: !!row.succeeded,
      attempted_at: row.attempted_at,
    })),
    limit,
  });
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
