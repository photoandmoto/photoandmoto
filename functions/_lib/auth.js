// functions/_lib/auth.js
//
// Shared authentication primitives for the /yllapito IAM system.
// See IAM_DESIGN.md (repo root) for the full design rationale.
//
// All hashing uses PBKDF2-SHA256 via Web Crypto API (built into the Cloudflare
// Workers runtime). bcrypt and argon2 are not usable in Workers without
// significant performance penalties. PBKDF2 at 200k iterations meets OWASP
// 2023 recommendations.
//
// Tokens (provisioning + recovery): 256-bit random, base64url-encoded,
// stored as SHA-256 hex (so DB leak doesn't expose the raw token).
//
// Sessions: 256-bit random, base64url-encoded, stored as SHA-256 hex (same
// reasoning — DB leak doesn't grant session takeover).
//
// All user-facing error messages are in Finnish.

// ─── Constants ──────────────────────────────────────────────────────────────

export const PBKDF2_ITERATIONS = 200_000;
export const SALT_LENGTH_BYTES = 16;
export const HASH_LENGTH_BITS = 256;
export const TOKEN_LENGTH_BYTES = 32;          // 256 bits → 43 base64url chars
export const SESSION_LENGTH_BYTES = 32;        // ditto
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;        // 30 days
export const PROVISIONING_TOKEN_TTL_SECONDS = 48 * 60 * 60;      // 48 hours
export const RECOVERY_TOKEN_TTL_SECONDS = 15 * 60;               // 15 minutes
export const SESSION_COOKIE_NAME = 'pm_session';
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

// Top-50 most-leaked passwords (subset of SecLists' rockyou top-100).
// Kept short for bundle size; sufficient to catch the laziest attempts.
const COMMON_PASSWORDS = new Set([
  '123456789012', '1234567890123', 'qwertyuiop12', 'qwerty1234567',
  'password1234', 'password!@#$', 'iloveyou1234', 'admin12345678',
  'welcome12345', 'sunshine1234', 'princess1234', 'football1234',
  'monkey1234567', 'shadow1234567', 'master1234567', 'letmein12345',
  'dragon1234567', 'qwertyuiopas', 'asdfghjkl123', 'zxcvbnm12345',
  'photoandmoto1', 'photoandmoto!', 'salasana1234', 'salasanaa1234',
  'photoandmoto2026', 'photoandmoto2025', 'photoandmoto12',
]);

// ─── Encoding helpers ───────────────────────────────────────────────────────

const encoder = new TextEncoder();

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// ─── Password / answer hashing (PBKDF2) ─────────────────────────────────────

/**
 * Hash a password (or security-question answer) using PBKDF2-SHA256.
 * Returns { hash, salt } — both base64-encoded for D1 storage.
 */
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    HASH_LENGTH_BITS
  );

  return {
    hash: bytesToBase64(new Uint8Array(derivedBits)),
    salt: bytesToBase64(salt),
  };
}

/**
 * Verify a password (or answer) against a stored hash + salt.
 * Uses constant-time comparison to avoid timing attacks.
 */
export async function verifyPassword(password, storedHashBase64, storedSaltBase64) {
  if (typeof password !== 'string' || !storedHashBase64 || !storedSaltBase64) {
    return false;
  }

  try {
    const salt = base64ToBytes(storedSaltBase64);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      HASH_LENGTH_BITS
    );

    const candidate = bytesToBase64(new Uint8Array(derivedBits));
    return constantTimeEqual(candidate, storedHashBase64);
  } catch {
    return false;
  }
}

/**
 * Normalize a security-question answer before hashing (lowercase, trim).
 * This means "Mikko" and "  mikko " and "MIKKO" all hash to the same value.
 */
export function normalizeAnswer(answer) {
  if (typeof answer !== 'string') return '';
  return answer.toLowerCase().trim();
}

export async function hashAnswer(answer) {
  return hashPassword(normalizeAnswer(answer));
}

export async function verifyAnswer(answer, storedHash, storedSalt) {
  return verifyPassword(normalizeAnswer(answer), storedHash, storedSalt);
}

// ─── Token / session ID generation ──────────────────────────────────────────

/**
 * Generate a random URL-safe token + its SHA-256 hex hash.
 * Returns { rawToken, tokenHash }. Store the hash, show the raw to the user once.
 */
export async function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH_BYTES));
  const rawToken = bytesToBase64Url(bytes);
  const tokenHash = await sha256Hex(rawToken);
  return { rawToken, tokenHash };
}

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? encoder.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Constant-time string compare (avoid leaking length-aware timing differences).
 * Both inputs must be base64 / hex strings of the same length for this to be
 * truly constant-time; padding short strings with zero bytes if you need
 * variable-length compare elsewhere.
 */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Session management ─────────────────────────────────────────────────────

/**
 * Create a new session row in D1 and return the raw session ID (for the cookie)
 * and the expiry timestamp.
 *
 * The DB stores SHA-256 of the session ID, not the raw value — same reasoning
 * as for provisioning tokens. The cookie carries the raw value.
 */
export async function createSession(env, userId, request) {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_LENGTH_BYTES));
  const rawSessionId = bytesToBase64Url(bytes);
  const sessionHash = await sha256Hex(rawSessionId);

  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const userAgent = (request?.headers?.get?.('user-agent') || '').slice(0, 500);
  const ip = getClientIp(request);

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, last_seen_at, user_agent, ip)
     VALUES (?, ?, ?, datetime('now'), ?, ?)`
  ).bind(sessionHash, userId, expiresAt, userAgent, ip).run();

  return { rawSessionId, expiresAt };
}

export async function destroySession(env, rawSessionId) {
  if (!rawSessionId) return;
  const sessionHash = await sha256Hex(rawSessionId);
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionHash).run();
}

export async function destroyAllSessionsForUser(env, userId) {
  await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
}

// ─── Cookie helpers ─────────────────────────────────────────────────────────

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || request.headers.get('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

export function getSessionCookieHeader(rawSessionId, maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  return (
    `${SESSION_COOKIE_NAME}=${rawSessionId}; ` +
    `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`
  );
}

export function getClearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function getClientIp(request) {
  if (!request || !request.headers) return null;
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    null
  );
}

// ─── Auth guard for protected endpoints ─────────────────────────────────────

/**
 * Look up the current user from the session cookie. Verifies session is not
 * expired and the user is active. Optionally enforces a specific permission.
 *
 * Returns either:
 *   { user, sessionRow }   on success
 *   { error, status }      on failure (401 or 403)
 *
 * `requiredPerm` is one of: 'tarkista', 'lahetakuva', 'hallitse_galleriaa',
 * 'hallitse_artikkeleita', 'admin_iam'. Pass null/undefined to require auth
 * without a specific permission.
 */
export async function requireAuth(request, env, requiredPerm = null) {
  const rawSessionId = getCookie(request, SESSION_COOKIE_NAME);
  if (!rawSessionId) {
    return { error: 'Ei aktiivista istuntoa', status: 401 };
  }

  const sessionHash = await sha256Hex(rawSessionId);
  const row = await env.DB.prepare(
    `SELECT
       s.id          AS session_id,
       s.user_id     AS user_id,
       s.expires_at  AS session_expires_at,
       u.first_name, u.last_name, u.email, u.role,
       u.perm_tarkista, u.perm_lahetakuva, u.perm_hallitse_galleriaa,
       u.perm_hallitse_artikkeleita, u.perm_admin_iam,
       u.is_active
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.id = ?
       AND s.expires_at > datetime('now')
       AND u.is_active = 1`
  ).bind(sessionHash).first();

  if (!row) {
    return { error: 'Istunto vanhentunut tai virheellinen', status: 401 };
  }

  if (requiredPerm) {
    const permCol = `perm_${requiredPerm}`;
    if (!row[permCol]) {
      return { error: 'Ei oikeutta tähän toimintoon', status: 403 };
    }
  }

  // Update last_seen_at lazily — fire and forget, don't block the response
  env.DB.prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`)
    .bind(sessionHash).run().catch(() => {});

  return {
    user: {
      id: row.user_id,
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
    },
    sessionRow: row,
  };
}

// ─── Password validation (NIST SP 800-63B style) ───────────────────────────

/**
 * Validate a candidate password against the policy.
 * Returns null if OK, or a Finnish error message describing the problem.
 *
 * userContext is { email, first_name, last_name } — used to block passwords
 * that contain the user's own data.
 */
export function validatePassword(password, userContext = {}) {
  if (typeof password !== 'string') {
    return 'Salasana puuttuu';
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Salasanan tulee olla vähintään ${PASSWORD_MIN_LENGTH} merkkiä`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Salasana saa olla enintään ${PASSWORD_MAX_LENGTH} merkkiä`;
  }

  let charTypes = 0;
  if (/[a-zäöå]/.test(password)) charTypes++;
  if (/[A-ZÄÖÅ]/.test(password)) charTypes++;
  if (/[0-9]/.test(password)) charTypes++;
  if (/[^a-zA-Z0-9äöåÄÖÅ]/.test(password)) charTypes++;
  if (charTypes < 3) {
    return 'Salasanan tulee sisältää vähintään kolmen tyyppisiä merkkejä (pieniä, isoja, numeroita, erikoismerkkejä)';
  }

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return 'Tämä salasana on liian yleinen — valitse jokin uniikimpi';
  }

  const blockTerms = [
    (userContext.email || '').split('@')[0].toLowerCase(),
    (userContext.first_name || '').toLowerCase(),
    (userContext.last_name || '').toLowerCase(),
    'photoandmoto',
  ].filter(term => term && term.length >= 4);

  for (const term of blockTerms) {
    if (lower.includes(term)) {
      return `Salasana ei voi sisältää tekstiä "${term}"`;
    }
  }

  return null;
}

// ─── Email + name validation ────────────────────────────────────────────────

export function validateEmail(email) {
  if (typeof email !== 'string') return 'Sähköposti puuttuu';
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return 'Virheellinen sähköposti';
  // Minimal email regex — full RFC 5322 is overkill; we just check shape
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Virheellinen sähköposti';
  return null;
}

export function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

export function validateName(name, label = 'Nimi') {
  if (typeof name !== 'string') return `${label} puuttuu`;
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) return `${label} on virheellinen`;
  return null;
}

// ─── Response helpers ───────────────────────────────────────────────────────

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

export function jsonResponse(body, init = {}) {
  const headers = { ...CORS_HEADERS, ...(init.headers || {}) };
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(message, status = 400, extraHeaders = {}) {
  return jsonResponse({ error: message }, { status, headers: extraHeaders });
}

export function corsOptionsResponse() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}
