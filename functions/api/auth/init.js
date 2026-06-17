// functions/api/auth/init.js
//
// Idempotent schema bootstrap for the /yllapito IAM tables.
// See IAM_DESIGN.md § 4 for the full schema rationale.
//
// Hit this manually once after the env vars are configured, or let it run
// automatically — the seed-superadmin endpoint calls runInit() before
// inserting the first user, and future auth endpoints will do the same.

import { jsonResponse, corsOptionsResponse } from '../../_lib/auth.js';

export async function runInit(env) {
  // ─── users ────────────────────────────────────────────────────────────
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'avustaja')),

      perm_tarkista INTEGER DEFAULT 0,
      perm_lahetakuva INTEGER DEFAULT 0,
      perm_hallitse_galleriaa INTEGER DEFAULT 0,
      perm_hallitse_artikkeleita INTEGER DEFAULT 0,
      perm_admin_iam INTEGER DEFAULT 0,
      perm_laheta_artikkeli INTEGER NOT NULL DEFAULT 0,
      perm_nahta_gemini_avain INTEGER NOT NULL DEFAULT 0,

      password_hash TEXT,
      password_salt TEXT,
      password_set_at TEXT,

      security_q1 TEXT, security_a1_hash TEXT, security_a1_salt TEXT,
      security_q2 TEXT, security_a2_hash TEXT, security_a2_salt TEXT,
      security_q3 TEXT, security_a3_hash TEXT, security_a3_salt TEXT,

      created_at TEXT DEFAULT (datetime('now')),
      created_by INTEGER,
      last_login_at TEXT,
      last_recovery_at TEXT,
      is_active INTEGER DEFAULT 1
    )
  `).run();

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active)`).run();

  // ─── provisioning_tokens ──────────────────────────────────────────────
  // One-time tokens for invite-acceptance and admin password resets.
  // Stored as SHA-256 hashes (raw values are shown once and then unrecoverable).
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS provisioning_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('initial_provision', 'admin_reset', 'self_recovery')),
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      created_by INTEGER,
      used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `).run();

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_tokens_user ON provisioning_tokens(user_id)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_tokens_expires ON provisioning_tokens(expires_at)`).run();

  // ─── sessions ─────────────────────────────────────────────────────────
  // id is the SHA-256 hash of the raw session ID. Cookie carries raw value.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      last_seen_at TEXT,
      user_agent TEXT,
      ip TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`).run();

  // ─── recovery_attempts ────────────────────────────────────────────────
  // Audit + rate-limiting source of truth. user_id is nullable so we can
  // log attempts against emails that don't exist (without leaking existence).
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS recovery_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email_attempted TEXT,
      ip TEXT,
      succeeded INTEGER DEFAULT 0,
      attempted_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `).run();

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_recovery_ip ON recovery_attempts(ip, attempted_at)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_recovery_email ON recovery_attempts(email_attempted, attempted_at)`).run();

  // ─── login_attempts ──────────────────────────────────────────
  // Rate-limiting source of truth for login attempts. Same shape as
  // recovery_attempts. user_id is nullable to log attempts on emails that
  // don't exist (without leaking existence).
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email_attempted TEXT,
      ip TEXT,
      succeeded INTEGER DEFAULT 0,
      attempted_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `).run();

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts(ip, attempted_at)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_login_email ON login_attempts(email_attempted, attempted_at)`).run();

  return { success: true };
}

export async function onRequestPost({ env }) {
  try {
    const result = await runInit(env);
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.message }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return corsOptionsResponse();
}
