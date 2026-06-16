var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../.wrangler/tmp/bundle-pcnWMs/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// _lib/auth.js
var PBKDF2_ITERATIONS = 1e5;
var SALT_LENGTH_BYTES = 16;
var HASH_LENGTH_BITS = 256;
var TOKEN_LENGTH_BYTES = 32;
var SESSION_LENGTH_BYTES = 32;
var SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
var SESSION_IDLE_TIMEOUT_SECONDS = 4 * 60 * 60;
var PROVISIONING_TOKEN_TTL_SECONDS = 48 * 60 * 60;
var RECOVERY_TOKEN_TTL_SECONDS = 15 * 60;
var SESSION_COOKIE_NAME = "pm_session";
var PASSWORD_MIN_LENGTH = 12;
var PASSWORD_MAX_LENGTH = 128;
var STATIC_DECOY_HASH = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
var STATIC_DECOY_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
var COMMON_PASSWORDS = /* @__PURE__ */ new Set([
  "123456789012",
  "1234567890123",
  "qwertyuiop12",
  "qwerty1234567",
  "password1234",
  "password!@#$",
  "iloveyou1234",
  "admin12345678",
  "welcome12345",
  "sunshine1234",
  "princess1234",
  "football1234",
  "monkey1234567",
  "shadow1234567",
  "master1234567",
  "letmein12345",
  "dragon1234567",
  "qwertyuiopas",
  "asdfghjkl123",
  "zxcvbnm12345",
  "photoandmoto1",
  "photoandmoto!",
  "salasana1234",
  "salasanaa1234",
  "photoandmoto2026",
  "photoandmoto2025",
  "photoandmoto12"
]);
var encoder = new TextEncoder();
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
__name(bytesToBase64, "bytesToBase64");
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(base64ToBytes, "base64ToBytes");
function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
__name(bytesToBase64Url, "bytesToBase64Url");
function bytesToHex(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
__name(bytesToHex, "bytesToHex");
async function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    HASH_LENGTH_BITS
  );
  return {
    hash: bytesToBase64(new Uint8Array(derivedBits)),
    salt: bytesToBase64(salt)
  };
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, storedHashBase64, storedSaltBase64) {
  if (typeof password !== "string" || !storedHashBase64 || !storedSaltBase64) {
    return false;
  }
  try {
    const salt = base64ToBytes(storedSaltBase64);
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      keyMaterial,
      HASH_LENGTH_BITS
    );
    const candidate = bytesToBase64(new Uint8Array(derivedBits));
    return constantTimeEqual(candidate, storedHashBase64);
  } catch {
    return false;
  }
}
__name(verifyPassword, "verifyPassword");
function normalizeAnswer(answer) {
  if (typeof answer !== "string") return "";
  return answer.toLowerCase().trim();
}
__name(normalizeAnswer, "normalizeAnswer");
async function hashAnswer(answer) {
  return hashPassword(normalizeAnswer(answer));
}
__name(hashAnswer, "hashAnswer");
async function verifyAnswer(answer, storedHash, storedSalt) {
  return verifyPassword(normalizeAnswer(answer), storedHash, storedSalt);
}
__name(verifyAnswer, "verifyAnswer");
async function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH_BYTES));
  const rawToken = bytesToBase64Url(bytes);
  const tokenHash = await sha256Hex(rawToken);
  return { rawToken, tokenHash };
}
__name(generateToken, "generateToken");
async function sha256Hex(input) {
  const data = typeof input === "string" ? encoder.encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}
__name(sha256Hex, "sha256Hex");
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
async function createSession(env, userId, request) {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_LENGTH_BYTES));
  const rawSessionId = bytesToBase64Url(bytes);
  const sessionHash = await sha256Hex(rawSessionId);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1e3).toISOString();
  const userAgent = (request?.headers?.get?.("user-agent") || "").slice(0, 500);
  const ip = getClientIp(request);
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, last_seen_at, user_agent, ip)
     VALUES (?, ?, ?, datetime('now'), ?, ?)`
  ).bind(sessionHash, userId, expiresAt, userAgent, ip).run();
  return { rawSessionId, expiresAt };
}
__name(createSession, "createSession");
async function destroySession(env, rawSessionId) {
  if (!rawSessionId) return;
  const sessionHash = await sha256Hex(rawSessionId);
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionHash).run();
}
__name(destroySession, "destroySession");
async function destroyAllSessionsForUser(env, userId) {
  await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
}
__name(destroyAllSessionsForUser, "destroyAllSessionsForUser");
function getCookie(request, name) {
  const header = request.headers.get("Cookie") || request.headers.get("cookie") || "";
  const match2 = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match2 ? match2[1] : null;
}
__name(getCookie, "getCookie");
function getSessionCookieHeader(rawSessionId, maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  return `${SESSION_COOKIE_NAME}=${rawSessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}
__name(getSessionCookieHeader, "getSessionCookieHeader");
function getClearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
__name(getClearSessionCookieHeader, "getClearSessionCookieHeader");
function getClientIp(request) {
  if (!request || !request.headers) return null;
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || null;
}
__name(getClientIp, "getClientIp");
async function requireAuth(request, env, requiredPerm = null) {
  const rawSessionId = getCookie(request, SESSION_COOKIE_NAME);
  if (!rawSessionId) {
    return { error: "Ei aktiivista istuntoa", status: 401 };
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
       AND s.last_seen_at IS NOT NULL
       AND s.last_seen_at > datetime('now', '-4 hours')
       AND u.is_active = 1`
  ).bind(sessionHash).first();
  if (!row) {
    return { error: "Istunto vanhentunut tai virheellinen", status: 401 };
  }
  if (requiredPerm) {
    const permCol = `perm_${requiredPerm}`;
    if (!row[permCol]) {
      return { error: "Ei oikeutta t\xE4h\xE4n toimintoon", status: 403 };
    }
  }
  env.DB.prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`).bind(sessionHash).run().catch(() => {
  });
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
        admin_iam: !!row.perm_admin_iam
      }
    },
    sessionRow: row
  };
}
__name(requireAuth, "requireAuth");
async function requireAuthOrLegacyPassword(request, env, requiredPerm, legacyPassword) {
  const authResult = await requireAuth(request, env, requiredPerm);
  if (authResult.user) {
    return { user: authResult.user, mode: "session" };
  }
  if (legacyPassword && env.UPLOAD_PASSWORD && legacyPassword === env.UPLOAD_PASSWORD) {
    return { user: null, mode: "legacy" };
  }
  return { error: authResult.error, status: authResult.status };
}
__name(requireAuthOrLegacyPassword, "requireAuthOrLegacyPassword");
function validatePassword(password, userContext = {}) {
  if (typeof password !== "string") {
    return "Salasana puuttuu";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Salasanan tulee olla v\xE4hint\xE4\xE4n ${PASSWORD_MIN_LENGTH} merkki\xE4`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Salasana saa olla enint\xE4\xE4n ${PASSWORD_MAX_LENGTH} merkki\xE4`;
  }
  let charTypes = 0;
  if (/[a-zäöå]/.test(password)) charTypes++;
  if (/[A-ZÄÖÅ]/.test(password)) charTypes++;
  if (/[0-9]/.test(password)) charTypes++;
  if (/[^a-zA-Z0-9äöåÄÖÅ]/.test(password)) charTypes++;
  if (charTypes < 3) {
    return "Salasanan tulee sis\xE4lt\xE4\xE4 v\xE4hint\xE4\xE4n kolmen tyyppisi\xE4 merkkej\xE4 (pieni\xE4, isoja, numeroita, erikoismerkkej\xE4)";
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return "T\xE4m\xE4 salasana on liian yleinen \u2014 valitse jokin uniikimpi";
  }
  const blockTerms = [
    (userContext.email || "").split("@")[0].toLowerCase(),
    (userContext.first_name || "").toLowerCase(),
    (userContext.last_name || "").toLowerCase(),
    "photoandmoto"
  ].filter((term) => term && term.length >= 4);
  for (const term of blockTerms) {
    if (lower.includes(term)) {
      return `Salasana ei voi sis\xE4lt\xE4\xE4 teksti\xE4 "${term}"`;
    }
  }
  return null;
}
__name(validatePassword, "validatePassword");
function validateEmail(email) {
  if (typeof email !== "string") return "S\xE4hk\xF6posti puuttuu";
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return "Virheellinen s\xE4hk\xF6posti";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Virheellinen s\xE4hk\xF6posti";
  return null;
}
__name(validateEmail, "validateEmail");
function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}
__name(normalizeEmail, "normalizeEmail");
function validateName(name, label = "Nimi") {
  if (typeof name !== "string") return `${label} puuttuu`;
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) return `${label} on virheellinen`;
  return null;
}
__name(validateName, "validateName");
var SECURITY_QUESTION_MIN_LENGTH = 8;
var SECURITY_QUESTION_MAX_LENGTH = 200;
var SECURITY_ANSWER_MIN_LENGTH = 2;
var SECURITY_ANSWER_MAX_LENGTH = 200;
var MIN_CORRECT_ANSWERS_FOR_RECOVERY = 2;
function validateSecurityQuestion(question) {
  if (typeof question !== "string") return "Kysymys puuttuu";
  const trimmed = question.trim();
  if (trimmed.length < SECURITY_QUESTION_MIN_LENGTH) {
    return `Kysymyksen tulee olla v\xE4hint\xE4\xE4n ${SECURITY_QUESTION_MIN_LENGTH} merkki\xE4`;
  }
  if (trimmed.length > SECURITY_QUESTION_MAX_LENGTH) {
    return `Kysymys saa olla enint\xE4\xE4n ${SECURITY_QUESTION_MAX_LENGTH} merkki\xE4`;
  }
  return null;
}
__name(validateSecurityQuestion, "validateSecurityQuestion");
function validateSecurityAnswer(answer) {
  if (typeof answer !== "string") return "Vastaus puuttuu";
  const trimmed = answer.trim();
  if (trimmed.length < SECURITY_ANSWER_MIN_LENGTH) {
    return `Vastauksen tulee olla v\xE4hint\xE4\xE4n ${SECURITY_ANSWER_MIN_LENGTH} merkki\xE4`;
  }
  if (trimmed.length > SECURITY_ANSWER_MAX_LENGTH) {
    return `Vastaus saa olla enint\xE4\xE4n ${SECURITY_ANSWER_MAX_LENGTH} merkki\xE4`;
  }
  return null;
}
__name(validateSecurityAnswer, "validateSecurityAnswer");
var DECOY_QUESTIONS = [
  "Mik\xE4 oli ensimm\xE4isen lemmikkisi nimi?",
  "Miss\xE4 kaupungissa k\xE4vit ala-asteen?",
  "Mik\xE4 on \xE4itisi tytt\xF6nimi?",
  "Mik\xE4 oli ensimm\xE4inen autosi merkki?",
  "Mik\xE4 oli lempiaineesi koulussa?",
  "Mik\xE4 on suosikkikirjasi?",
  "Miss\xE4 vietit ensimm\xE4isen lomasi?",
  "Mik\xE4 on lempiruokasi?",
  "Mik\xE4 oli ensimm\xE4isen koulusi nimi?",
  "Miss\xE4 syntyiv\xE4t vanhempasi?",
  "Mik\xE4 oli lapsuutesi paras yst\xE4v\xE4?",
  "Mik\xE4 oli ensimm\xE4isen ty\xF6paikkasi nimi?"
];
async function getDecoyQuestions(email) {
  const hash = await sha256Hex(`decoy:${normalizeEmail(email)}`);
  const indices = [];
  for (let i = 0; indices.length < 3 && i < hash.length - 1; i += 2) {
    const byte = parseInt(hash.slice(i, i + 2), 16);
    const idx = byte % DECOY_QUESTIONS.length;
    if (!indices.includes(idx)) indices.push(idx);
  }
  return indices.map((i) => DECOY_QUESTIONS[i]);
}
__name(getDecoyQuestions, "getDecoyQuestions");
async function getJsonBody(request) {
  try {
    const text = await request.text();
    if (!text || !text.trim()) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}
__name(getJsonBody, "getJsonBody");
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Content-Type": "application/json"
};
function jsonResponse(body, init = {}) {
  const headers = { ...CORS_HEADERS, ...init.headers || {} };
  return new Response(JSON.stringify(body), { ...init, headers });
}
__name(jsonResponse, "jsonResponse");
function errorResponse(message, status = 400, extraHeaders = {}) {
  return jsonResponse({ error: message }, { status, headers: extraHeaders });
}
__name(errorResponse, "errorResponse");
function corsOptionsResponse() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Credentials": "true"
    }
  });
}
__name(corsOptionsResponse, "corsOptionsResponse");

// api/auth/init.js
async function runInit(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),

      perm_tarkista INTEGER DEFAULT 0,
      perm_lahetakuva INTEGER DEFAULT 0,
      perm_hallitse_galleriaa INTEGER DEFAULT 0,
      perm_hallitse_artikkeleita INTEGER DEFAULT 0,
      perm_admin_iam INTEGER DEFAULT 0,

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
      is_active INTEGER DEFAULT 1,

      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active)`).run();
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
__name(runInit, "runInit");
async function onRequestPost({ env }) {
  try {
    const result = await runInit(env);
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.message }, { status: 500 });
  }
}
__name(onRequestPost, "onRequestPost");
async function onRequestOptions() {
  return corsOptionsResponse();
}
__name(onRequestOptions, "onRequestOptions");

// api/auth/users/[id]/deactivate.js
async function onRequestPost2({ request, env, params }) {
  await runInit(env);
  const auth = await requireAuth(request, env, "admin_iam");
  if (auth.error) return errorResponse(auth.error, auth.status);
  const userId = Number(params.id);
  if (!userId || Number.isNaN(userId)) {
    return errorResponse("Virheellinen k\xE4ytt\xE4j\xE4n ID", 400);
  }
  if (userId === auth.user.id) {
    return errorResponse("Et voi poistaa omaa tili\xE4si k\xE4yt\xF6st\xE4.", 403);
  }
  const target = await env.DB.prepare(
    `SELECT id, is_active, perm_admin_iam FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!target) return errorResponse("K\xE4ytt\xE4j\xE4\xE4 ei l\xF6ytynyt", 404);
  if (!target.is_active) {
    return errorResponse("Tili on jo poistettu k\xE4yt\xF6st\xE4.", 409);
  }
  if (target.perm_admin_iam) {
    const remaining = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM users
      WHERE is_active = 1 AND perm_admin_iam = 1 AND id != ?
    `).bind(userId).first();
    if ((remaining?.n ?? 0) < 1) {
      return errorResponse(
        "V\xE4hint\xE4\xE4n yksi aktiivinen yll\xE4pit\xE4j\xE4 vaaditaan. Lis\xE4\xE4 toinen yll\xE4pit\xE4j\xE4 ennen t\xE4t\xE4 muutosta.",
        409
      );
    }
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET is_active = 0 WHERE id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId)
  ]);
  return jsonResponse({ success: true });
}
__name(onRequestPost2, "onRequestPost");
async function onRequestOptions2() {
  return corsOptionsResponse();
}
__name(onRequestOptions2, "onRequestOptions");

// api/auth/users/[id]/regenerate-link.js
async function onRequestPost3({ request, env, params }) {
  await runInit(env);
  const auth = await requireAuth(request, env, "admin_iam");
  if (auth.error) return errorResponse(auth.error, auth.status);
  const userId = Number(params.id);
  if (!userId || Number.isNaN(userId)) {
    return errorResponse("Virheellinen k\xE4ytt\xE4j\xE4n ID", 400);
  }
  const target = await env.DB.prepare(
    `SELECT id, is_active FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!target) return errorResponse("K\xE4ytt\xE4j\xE4\xE4 ei l\xF6ytynyt", 404);
  if (!target.is_active) {
    return errorResponse(
      "Tili ei ole k\xE4yt\xF6ss\xE4. Aktivoi se ensin ennen uuden linkin luomista.",
      409
    );
  }
  const { rawToken, tokenHash } = await generateToken();
  const expiresAt = new Date(Date.now() + PROVISIONING_TOKEN_TTL_SECONDS * 1e3).toISOString();
  await env.DB.batch([
    // Mark any unused tokens for this user as used (consumed without effect)
    env.DB.prepare(`
      UPDATE provisioning_tokens
      SET used_at = datetime('now')
      WHERE user_id = ? AND used_at IS NULL
    `).bind(userId),
    // Wipe password + security questions
    env.DB.prepare(`
      UPDATE users SET
        password_hash = NULL, password_salt = NULL, password_set_at = NULL,
        security_q1 = NULL, security_a1_hash = NULL, security_a1_salt = NULL,
        security_q2 = NULL, security_a2_hash = NULL, security_a2_salt = NULL,
        security_q3 = NULL, security_a3_hash = NULL, security_a3_salt = NULL
      WHERE id = ?
    `).bind(userId),
    // Insert new admin_reset token
    env.DB.prepare(`
      INSERT INTO provisioning_tokens (token_hash, user_id, purpose, expires_at, created_by)
      VALUES (?, ?, 'admin_reset', ?, ?)
    `).bind(tokenHash, userId, expiresAt, auth.user.id),
    // Destroy all sessions for this user
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId)
  ]);
  const url = new URL(request.url);
  const provisioningLink = `${url.protocol}//${url.host}/fi/aseta-salasana?token=${rawToken}`;
  return jsonResponse({
    success: true,
    provisioning_link: provisioningLink,
    expires_at: expiresAt
  });
}
__name(onRequestPost3, "onRequestPost");
async function onRequestOptions3() {
  return corsOptionsResponse();
}
__name(onRequestOptions3, "onRequestOptions");

// api/auth/audit/recoveries.js
var DEFAULT_LIMIT = 50;
var MAX_LIMIT = 200;
async function onRequestGet({ request, env }) {
  await runInit(env);
  const auth = await requireAuth(request, env, "admin_iam");
  if (auth.error) return errorResponse(auth.error, auth.status);
  const url = new URL(request.url);
  let limit = Number(url.searchParams.get("limit")) || DEFAULT_LIMIT;
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
    attempts: (results || []).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      user_first_name: row.first_name,
      user_last_name: row.last_name,
      user_email: row.email,
      email_attempted: row.email_attempted,
      ip: row.ip,
      succeeded: !!row.succeeded,
      attempted_at: row.attempted_at
    })),
    limit
  });
}
__name(onRequestGet, "onRequestGet");
async function onRequestOptions4() {
  return corsOptionsResponse();
}
__name(onRequestOptions4, "onRequestOptions");

// api/auth/recovery/complete.js
async function onRequestPost4({ request, env }) {
  await runInit(env);
  const body = await getJsonBody(request);
  if (!body) return errorResponse("Virheellinen pyynt\xF6", 400);
  const rawToken = typeof body.recovery_token === "string" ? body.recovery_token : "";
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";
  if (!rawToken || !newPassword) {
    return errorResponse("Recovery token ja uusi salasana vaaditaan", 400);
  }
  const tokenHash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    `SELECT t.purpose, t.expires_at, t.used_at, t.user_id,
            u.first_name, u.last_name, u.email, u.is_active
     FROM provisioning_tokens t
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.purpose = 'self_recovery'`
  ).bind(tokenHash).first();
  if (!row) return errorResponse("Recovery token on virheellinen", 410);
  if (row.used_at) return errorResponse("Recovery token on jo k\xE4ytetty", 410);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return errorResponse("Recovery token on vanhentunut", 410);
  }
  if (!row.is_active) return errorResponse("Tili ei ole k\xE4yt\xF6ss\xE4", 410);
  const policyError = validatePassword(newPassword, {
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name
  });
  if (policyError) return errorResponse(policyError, 400);
  const pw = await hashPassword(newPassword);
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_set_at = datetime('now'),
          last_recovery_at = datetime('now')
      WHERE id = ?
    `).bind(pw.hash, pw.salt, row.user_id),
    env.DB.prepare(
      `UPDATE provisioning_tokens SET used_at = datetime('now') WHERE token_hash = ?`
    ).bind(tokenHash)
  ]);
  await destroyAllSessionsForUser(env, row.user_id);
  const { rawSessionId } = await createSession(env, row.user_id, request);
  return jsonResponse(
    { success: true },
    { headers: { "Set-Cookie": getSessionCookieHeader(rawSessionId) } }
  );
}
__name(onRequestPost4, "onRequestPost");
async function onRequestOptions5() {
  return corsOptionsResponse();
}
__name(onRequestOptions5, "onRequestOptions");

// api/auth/recovery/start.js
async function onRequestPost5({ request, env }) {
  await runInit(env);
  const body = await getJsonBody(request);
  const email = normalizeEmail(body?.email);
  if (!email) return errorResponse("S\xE4hk\xF6posti puuttuu", 400);
  const user = await env.DB.prepare(
    `SELECT security_q1, security_q2, security_q3, is_active, password_hash
     FROM users WHERE email = ?`
  ).bind(email).first();
  if (!user || !user.is_active || !user.password_hash || !user.security_q1 || !user.security_q2 || !user.security_q3) {
    const decoys = await getDecoyQuestions(email);
    return jsonResponse({
      questions: decoys
    });
  }
  return jsonResponse({
    questions: [user.security_q1, user.security_q2, user.security_q3]
  });
}
__name(onRequestPost5, "onRequestPost");
async function onRequestOptions6() {
  return corsOptionsResponse();
}
__name(onRequestOptions6, "onRequestOptions");

// api/auth/recovery/verify.js
var MAX_RECOVERY_ATTEMPTS_PER_HOUR = 5;
var GENERIC_RECOVERY_ERROR = "Vastaukset eiv\xE4t t\xE4sm\xE4\xE4";
async function logAttempt(env, userId, email, ip, succeeded) {
  try {
    await env.DB.prepare(
      `INSERT INTO recovery_attempts (user_id, email_attempted, ip, succeeded)
       VALUES (?, ?, ?, ?)`
    ).bind(userId, email, ip, succeeded ? 1 : 0).run();
  } catch {
  }
}
__name(logAttempt, "logAttempt");
async function isRateLimited(env, email, ip) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM recovery_attempts
     WHERE attempted_at > datetime('now', '-1 hour')
       AND (email_attempted = ? OR ip = ?)`
  ).bind(email, ip).first();
  return (row?.n ?? 0) >= MAX_RECOVERY_ATTEMPTS_PER_HOUR;
}
__name(isRateLimited, "isRateLimited");
async function onRequestPost6({ request, env }) {
  await runInit(env);
  const body = await getJsonBody(request);
  if (!body) return errorResponse("Virheellinen pyynt\xF6", 400);
  const email = normalizeEmail(body.email);
  const answers = Array.isArray(body.answers) ? body.answers : null;
  const ip = getClientIp(request);
  if (!email || !answers || answers.length !== 3) {
    return errorResponse(GENERIC_RECOVERY_ERROR, 401);
  }
  if (await isRateLimited(env, email, ip)) {
    return errorResponse(
      "Liian monta yrityst\xE4. Yrit\xE4 uudelleen tunnin kuluttua tai ota yhteytt\xE4 yll\xE4pit\xE4j\xE4\xE4n.",
      429
    );
  }
  const user = await env.DB.prepare(
    `SELECT id, is_active, password_hash,
            security_a1_hash, security_a1_salt,
            security_a2_hash, security_a2_salt,
            security_a3_hash, security_a3_salt
     FROM users WHERE email = ?`
  ).bind(email).first();
  if (!user || !user.is_active || !user.password_hash || !user.security_a1_hash || !user.security_a2_hash || !user.security_a3_hash) {
    await verifyPassword(
      typeof answers[0] === "string" ? answers[0] : "x",
      STATIC_DECOY_HASH,
      STATIC_DECOY_SALT
    );
    await logAttempt(env, user?.id || null, email, ip, false);
    return errorResponse(GENERIC_RECOVERY_ERROR, 401);
  }
  let correct = 0;
  const a1 = typeof answers[0] === "string" ? answers[0] : "";
  const a2 = typeof answers[1] === "string" ? answers[1] : "";
  const a3 = typeof answers[2] === "string" ? answers[2] : "";
  if (a1 && await verifyAnswer(a1, user.security_a1_hash, user.security_a1_salt)) correct++;
  if (a2 && await verifyAnswer(a2, user.security_a2_hash, user.security_a2_salt)) correct++;
  if (a3 && await verifyAnswer(a3, user.security_a3_hash, user.security_a3_salt)) correct++;
  if (correct < MIN_CORRECT_ANSWERS_FOR_RECOVERY) {
    await logAttempt(env, user.id, email, ip, false);
    return errorResponse(GENERIC_RECOVERY_ERROR, 401);
  }
  const { rawToken, tokenHash } = await generateToken();
  const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_TTL_SECONDS * 1e3).toISOString();
  await env.DB.prepare(`
    INSERT INTO provisioning_tokens (token_hash, user_id, purpose, expires_at)
    VALUES (?, ?, 'self_recovery', ?)
  `).bind(tokenHash, user.id, expiresAt).run();
  await logAttempt(env, user.id, email, ip, true);
  return jsonResponse({
    success: true,
    recovery_token: rawToken,
    expires_at: expiresAt
  });
}
__name(onRequestPost6, "onRequestPost");
async function onRequestOptions7() {
  return corsOptionsResponse();
}
__name(onRequestOptions7, "onRequestOptions");

// api/auth/users/[id].js
var VALID_ROLES = ["admin", "editor"];
async function countActiveAdmins(env, excludingUserId = null) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS n FROM users
    WHERE is_active = 1 AND perm_admin_iam = 1
    ${excludingUserId ? "AND id != ?" : ""}
  `).bind(...excludingUserId ? [excludingUserId] : []).first();
  return row?.n ?? 0;
}
__name(countActiveAdmins, "countActiveAdmins");
async function onRequestPatch({ request, env, params }) {
  await runInit(env);
  const auth = await requireAuth(request, env, "admin_iam");
  if (auth.error) return errorResponse(auth.error, auth.status);
  const userId = Number(params.id);
  if (!userId || Number.isNaN(userId)) {
    return errorResponse("Virheellinen k\xE4ytt\xE4j\xE4n ID", 400);
  }
  const target = await env.DB.prepare(
    `SELECT id, first_name, last_name, role,
            perm_tarkista, perm_lahetakuva, perm_hallitse_galleriaa,
            perm_hallitse_artikkeleita, perm_admin_iam,
            is_active
     FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!target) return errorResponse("K\xE4ytt\xE4j\xE4\xE4 ei l\xF6ytynyt", 404);
  const body = await getJsonBody(request);
  if (!body) return errorResponse("Virheellinen pyynt\xF6", 400);
  const isSelf = userId === auth.user.id;
  const merged = {
    first_name: body.first_name !== void 0 ? String(body.first_name).trim() : target.first_name,
    last_name: body.last_name !== void 0 ? String(body.last_name).trim() : target.last_name,
    role: body.role !== void 0 ? body.role : target.role,
    perm_tarkista: body.permissions?.tarkista !== void 0 ? body.permissions.tarkista ? 1 : 0 : target.perm_tarkista,
    perm_lahetakuva: body.permissions?.lahetakuva !== void 0 ? body.permissions.lahetakuva ? 1 : 0 : target.perm_lahetakuva,
    perm_hallitse_galleriaa: body.permissions?.hallitse_galleriaa !== void 0 ? body.permissions.hallitse_galleriaa ? 1 : 0 : target.perm_hallitse_galleriaa,
    perm_hallitse_artikkeleita: body.permissions?.hallitse_artikkeleita !== void 0 ? body.permissions.hallitse_artikkeleita ? 1 : 0 : target.perm_hallitse_artikkeleita,
    perm_admin_iam: body.permissions?.admin_iam !== void 0 ? body.permissions.admin_iam ? 1 : 0 : target.perm_admin_iam,
    is_active: body.is_active !== void 0 ? body.is_active ? 1 : 0 : target.is_active
  };
  const firstErr = validateName(merged.first_name, "Etunimi");
  if (firstErr) return errorResponse(firstErr, 400);
  const lastErr = validateName(merged.last_name, "Sukunimi");
  if (lastErr) return errorResponse(lastErr, 400);
  if (!VALID_ROLES.includes(merged.role)) {
    return errorResponse("Rooli on virheellinen", 400);
  }
  if (isSelf && merged.perm_admin_iam === 0 && target.perm_admin_iam === 1) {
    return errorResponse(
      "Et voi poistaa omia yll\xE4pit\xE4j\xE4n oikeuksiasi. Pyyd\xE4 toista yll\xE4pit\xE4j\xE4\xE4 tekem\xE4\xE4n se.",
      403
    );
  }
  if (isSelf && merged.is_active === 0 && target.is_active === 1) {
    return errorResponse(
      "Et voi poistaa omaa tili\xE4si k\xE4yt\xF6st\xE4.",
      403
    );
  }
  const losingAdminIam = target.perm_admin_iam === 1 && merged.perm_admin_iam === 0;
  const beingDeactivated = target.is_active === 1 && merged.is_active === 0;
  if (losingAdminIam || beingDeactivated) {
    const remaining = await countActiveAdmins(env, userId);
    if (remaining < 1) {
      return errorResponse(
        "V\xE4hint\xE4\xE4n yksi aktiivinen yll\xE4pit\xE4j\xE4 vaaditaan. Lis\xE4\xE4 toinen yll\xE4pit\xE4j\xE4 ennen t\xE4t\xE4 muutosta.",
        409
      );
    }
  }
  await env.DB.prepare(`
    UPDATE users SET
      first_name = ?, last_name = ?, role = ?,
      perm_tarkista = ?, perm_lahetakuva = ?,
      perm_hallitse_galleriaa = ?, perm_hallitse_artikkeleita = ?,
      perm_admin_iam = ?,
      is_active = ?
    WHERE id = ?
  `).bind(
    merged.first_name,
    merged.last_name,
    merged.role,
    merged.perm_tarkista,
    merged.perm_lahetakuva,
    merged.perm_hallitse_galleriaa,
    merged.perm_hallitse_artikkeleita,
    merged.perm_admin_iam,
    merged.is_active,
    userId
  ).run();
  if (beingDeactivated) {
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
  }
  const updated = await env.DB.prepare(`
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
        admin_iam: !!updated.perm_admin_iam
      },
      is_active: !!updated.is_active,
      has_password: !!updated.has_password,
      created_at: updated.created_at,
      last_login_at: updated.last_login_at,
      last_recovery_at: updated.last_recovery_at
    }
  });
}
__name(onRequestPatch, "onRequestPatch");
async function onRequestOptions8() {
  return corsOptionsResponse();
}
__name(onRequestOptions8, "onRequestOptions");

// api/mystery/image/[id].js
async function onRequestGet2(context) {
  const { env, params } = context;
  const id = parseInt(params.id);
  try {
    const photo = await env.DB.prepare(
      "SELECT image_data, content_type FROM photos WHERE id = ?"
    ).bind(id).first();
    if (!photo) {
      return new Response("Not found", { status: 404 });
    }
    const binaryString = atob(photo.image_data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Response(bytes, {
      headers: {
        "Content-Type": photo.content_type || "image/jpeg",
        "Cache-Control": "public, max-age=86400"
      }
    });
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500 });
  }
}
__name(onRequestGet2, "onRequestGet");

// api/mystery/image/[key].js
async function onRequestGet3(context) {
  const { env, params } = context;
  const key = `photos/${params.key}`;
  try {
    const object = await env.MYSTERY_PHOTOS.get(key);
    if (!object) {
      return new Response("Not found", { status: 404 });
    }
    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
    headers.set("Cache-Control", "public, max-age=86400");
    return new Response(object.body, { headers });
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500 });
  }
}
__name(onRequestGet3, "onRequestGet");

// api/auth/accept-invite.js
async function onRequestPost7({ request, env }) {
  await runInit(env);
  const body = await getJsonBody(request);
  if (!body) return errorResponse("Virheellinen pyynt\xF6", 400);
  const rawToken = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  const sqRaw = Array.isArray(body.security_questions) ? body.security_questions : null;
  if (!rawToken || !password || !sqRaw || sqRaw.length !== 3) {
    return errorResponse("Token, salasana ja kolme turvakysymyst\xE4 vaaditaan", 400);
  }
  for (let i = 0; i < 3; i++) {
    const item = sqRaw[i] || {};
    const qErr = validateSecurityQuestion(item.question);
    if (qErr) return errorResponse(`Kysymys ${i + 1}: ${qErr}`, 400);
    const aErr = validateSecurityAnswer(item.answer);
    if (aErr) return errorResponse(`Vastaus ${i + 1}: ${aErr}`, 400);
  }
  const tokenHash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    `SELECT t.purpose, t.expires_at, t.used_at, t.user_id,
            u.first_name, u.last_name, u.email, u.is_active
     FROM provisioning_tokens t
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?`
  ).bind(tokenHash).first();
  if (!row) return errorResponse("Linkki on virheellinen tai vanhentunut", 410);
  if (row.used_at) return errorResponse("Linkki on jo k\xE4ytetty", 410);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return errorResponse("Linkki on vanhentunut", 410);
  }
  if (!row.is_active) return errorResponse("Tili ei ole k\xE4yt\xF6ss\xE4", 410);
  const policyError = validatePassword(password, {
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name
  });
  if (policyError) return errorResponse(policyError, 400);
  const pw = await hashPassword(password);
  const a1 = await hashAnswer(sqRaw[0].answer);
  const a2 = await hashAnswer(sqRaw[1].answer);
  const a3 = await hashAnswer(sqRaw[2].answer);
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users SET
        password_hash = ?, password_salt = ?, password_set_at = datetime('now'),
        security_q1 = ?, security_a1_hash = ?, security_a1_salt = ?,
        security_q2 = ?, security_a2_hash = ?, security_a2_salt = ?,
        security_q3 = ?, security_a3_hash = ?, security_a3_salt = ?
      WHERE id = ?
    `).bind(
      pw.hash,
      pw.salt,
      sqRaw[0].question.trim(),
      a1.hash,
      a1.salt,
      sqRaw[1].question.trim(),
      a2.hash,
      a2.salt,
      sqRaw[2].question.trim(),
      a3.hash,
      a3.salt,
      row.user_id
    ),
    env.DB.prepare(
      `UPDATE provisioning_tokens SET used_at = datetime('now') WHERE token_hash = ?`
    ).bind(tokenHash)
  ]);
  const user = await env.DB.prepare(
    `SELECT id, first_name, last_name, email, role,
            perm_tarkista, perm_lahetakuva, perm_hallitse_galleriaa,
            perm_hallitse_artikkeleita, perm_admin_iam
     FROM users WHERE id = ?`
  ).bind(row.user_id).first();
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
          admin_iam: !!user.perm_admin_iam
        }
      }
    },
    {
      headers: { "Set-Cookie": getSessionCookieHeader(rawSessionId) }
    }
  );
}
__name(onRequestPost7, "onRequestPost");
async function onRequestOptions9() {
  return corsOptionsResponse();
}
__name(onRequestOptions9, "onRequestOptions");

// api/auth/change-password.js
async function onRequestPost8({ request, env }) {
  const auth = await requireAuth(request, env);
  if (auth.error) return errorResponse(auth.error, auth.status);
  const body = await getJsonBody(request);
  if (!body) return errorResponse("Virheellinen pyynt\xF6", 400);
  const currentPassword = typeof body.current_password === "string" ? body.current_password : "";
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";
  if (!currentPassword || !newPassword) {
    return errorResponse("Nykyinen ja uusi salasana vaaditaan", 400);
  }
  const policyError = validatePassword(newPassword, {
    email: auth.user.email,
    first_name: auth.user.first_name,
    last_name: auth.user.last_name
  });
  if (policyError) return errorResponse(policyError, 400);
  if (currentPassword === newPassword) {
    return errorResponse("Uusi salasana ei voi olla sama kuin nykyinen", 400);
  }
  const user = await env.DB.prepare(
    `SELECT password_hash, password_salt FROM users WHERE id = ?`
  ).bind(auth.user.id).first();
  if (!user || !user.password_hash) {
    return errorResponse("Tili\xE4 ei voi muokata", 500);
  }
  const ok = await verifyPassword(currentPassword, user.password_hash, user.password_salt);
  if (!ok) {
    return errorResponse("Nykyinen salasana on v\xE4\xE4r\xE4", 401);
  }
  const { hash, salt } = await hashPassword(newPassword);
  await env.DB.prepare(
    `UPDATE users
     SET password_hash = ?, password_salt = ?, password_set_at = datetime('now')
     WHERE id = ?`
  ).bind(hash, salt, auth.user.id).run();
  return jsonResponse({ success: true });
}
__name(onRequestPost8, "onRequestPost");
async function onRequestOptions10() {
  return corsOptionsResponse();
}
__name(onRequestOptions10, "onRequestOptions");

// api/auth/login.js
var MAX_FAILED_LOGINS_PER_HOUR = 5;
var GENERIC_LOGIN_ERROR = "V\xE4\xE4r\xE4 s\xE4hk\xF6posti tai salasana";
async function logAttempt2(env, userId, email, ip, succeeded) {
  try {
    await env.DB.prepare(
      `INSERT INTO login_attempts (user_id, email_attempted, ip, succeeded)
       VALUES (?, ?, ?, ?)`
    ).bind(userId, email, ip, succeeded ? 1 : 0).run();
  } catch {
  }
}
__name(logAttempt2, "logAttempt");
async function isRateLimited2(env, email, ip) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
     WHERE succeeded = 0
       AND attempted_at > datetime('now', '-1 hour')
       AND (email_attempted = ? OR ip = ?)`
  ).bind(email, ip).first();
  return (row?.n ?? 0) >= MAX_FAILED_LOGINS_PER_HOUR;
}
__name(isRateLimited2, "isRateLimited");
async function onRequestPost9({ request, env }) {
  await runInit(env);
  const body = await getJsonBody(request);
  if (!body) return errorResponse("Virheellinen pyynt\xF6", 400);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const ip = getClientIp(request);
  if (!email || !password) {
    return errorResponse(GENERIC_LOGIN_ERROR, 401);
  }
  if (await isRateLimited2(env, email, ip)) {
    return errorResponse(
      "Liian monta ep\xE4onnistunutta yrityst\xE4. Yrit\xE4 uudelleen tunnin kuluttua.",
      429
    );
  }
  const user = await env.DB.prepare(
    `SELECT id, first_name, last_name, email, role,
            perm_tarkista, perm_lahetakuva, perm_hallitse_galleriaa,
            perm_hallitse_artikkeleita, perm_admin_iam,
            password_hash, password_salt, is_active
     FROM users WHERE email = ?`
  ).bind(email).first();
  if (!user) {
    await verifyPassword(password, STATIC_DECOY_HASH, STATIC_DECOY_SALT);
    await logAttempt2(env, null, email, ip, false);
    return errorResponse(GENERIC_LOGIN_ERROR, 401);
  }
  if (!user.is_active) {
    await verifyPassword(password, STATIC_DECOY_HASH, STATIC_DECOY_SALT);
    await logAttempt2(env, user.id, email, ip, false);
    return errorResponse(GENERIC_LOGIN_ERROR, 401);
  }
  if (!user.password_hash || !user.password_salt) {
    await verifyPassword(password, STATIC_DECOY_HASH, STATIC_DECOY_SALT);
    await logAttempt2(env, user.id, email, ip, false);
    return errorResponse(GENERIC_LOGIN_ERROR, 401);
  }
  const ok = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) {
    await logAttempt2(env, user.id, email, ip, false);
    return errorResponse(GENERIC_LOGIN_ERROR, 401);
  }
  const { rawSessionId } = await createSession(env, user.id, request);
  await env.DB.prepare(
    `UPDATE users SET last_login_at = datetime('now') WHERE id = ?`
  ).bind(user.id).run();
  await logAttempt2(env, user.id, email, ip, true);
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
          admin_iam: !!user.perm_admin_iam
        }
      }
    },
    {
      headers: { "Set-Cookie": getSessionCookieHeader(rawSessionId) }
    }
  );
}
__name(onRequestPost9, "onRequestPost");
async function onRequestOptions11() {
  return corsOptionsResponse();
}
__name(onRequestOptions11, "onRequestOptions");

// api/auth/logout.js
async function onRequestPost10({ request, env }) {
  const rawSessionId = getCookie(request, SESSION_COOKIE_NAME);
  if (rawSessionId) {
    await destroySession(env, rawSessionId);
  }
  return jsonResponse(
    { success: true },
    { headers: { "Set-Cookie": getClearSessionCookieHeader() } }
  );
}
__name(onRequestPost10, "onRequestPost");
async function onRequestOptions12() {
  return corsOptionsResponse();
}
__name(onRequestOptions12, "onRequestOptions");

// api/auth/me.js
async function onRequestGet4({ request, env }) {
  const auth = await requireAuth(request, env);
  if (auth.error) return errorResponse(auth.error, auth.status);
  return jsonResponse({ user: auth.user });
}
__name(onRequestGet4, "onRequestGet");
async function onRequestOptions13() {
  return corsOptionsResponse();
}
__name(onRequestOptions13, "onRequestOptions");

// api/auth/seed-superadmin.js
async function onRequestGet5() {
  return jsonResponse({
    endpoint: "seed-superadmin",
    method: "POST",
    description: "One-time creation of the first super-admin user. Requires SUPER_ADMIN_EMAIL, SUPER_ADMIN_FIRST_NAME, SUPER_ADMIN_LAST_NAME env vars. Refuses if any user already exists.",
    docs: "See IAM_DESIGN.md \xA7 8 (Migration plan, Phase D)"
  });
}
__name(onRequestGet5, "onRequestGet");
async function onRequestPost11({ request, env }) {
  try {
    await runInit(env);
    const existing = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users`
    ).first();
    if ((existing?.n ?? 0) > 0) {
      return errorResponse(
        "Seed refused: at least one user already exists. To re-seed, delete all users from D1 first.",
        409
      );
    }
    const email = normalizeEmail(env.SUPER_ADMIN_EMAIL);
    const firstName = (env.SUPER_ADMIN_FIRST_NAME || "").trim();
    const lastName = (env.SUPER_ADMIN_LAST_NAME || "").trim();
    if (!email || !firstName || !lastName) {
      return errorResponse(
        "Missing one or more required env vars: SUPER_ADMIN_EMAIL, SUPER_ADMIN_FIRST_NAME, SUPER_ADMIN_LAST_NAME",
        400
      );
    }
    const emailErr = validateEmail(email);
    if (emailErr) return errorResponse(`SUPER_ADMIN_EMAIL invalid: ${emailErr}`, 400);
    const firstErr = validateName(firstName, "SUPER_ADMIN_FIRST_NAME");
    if (firstErr) return errorResponse(firstErr, 400);
    const lastErr = validateName(lastName, "SUPER_ADMIN_LAST_NAME");
    if (lastErr) return errorResponse(lastErr, 400);
    if (env.SUPER_ADMIN_SEED_SECRET) {
      let providedSecret = null;
      try {
        const body = await request.json();
        providedSecret = body?.seed_secret;
      } catch {
      }
      if (providedSecret !== env.SUPER_ADMIN_SEED_SECRET) {
        return errorResponse(
          "Seed refused: SUPER_ADMIN_SEED_SECRET is set on the server but the request did not include a matching seed_secret.",
          403
        );
      }
    }
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
      return errorResponse("Failed to insert super-admin user", 500);
    }
    const { rawToken, tokenHash } = await generateToken();
    const expiresAt = new Date(
      Date.now() + PROVISIONING_TOKEN_TTL_SECONDS * 1e3
    ).toISOString();
    await env.DB.prepare(`
      INSERT INTO provisioning_tokens (
        token_hash, user_id, purpose, expires_at, created_by
      )
      VALUES (?, ?, 'initial_provision', ?, ?)
    `).bind(tokenHash, userId, expiresAt, userId).run();
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const provisioningLink = `${origin}/fi/aseta-salasana?token=${rawToken}`;
    console.log("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501");
    console.log("SUPER-ADMIN SEED COMPLETE");
    console.log(`User: ${firstName} ${lastName} <${email}>`);
    console.log(`User ID: ${userId}`);
    console.log(`Token expires: ${expiresAt}`);
    console.log(`Provisioning link (one-time, copy now):`);
    console.log(provisioningLink);
    console.log("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501");
    return jsonResponse({
      success: true,
      user: {
        id: userId,
        email,
        first_name: firstName,
        last_name: lastName,
        role: "admin"
      },
      provisioning_link: provisioningLink,
      expires_at: expiresAt,
      note: "This link will be shown only once. The /fi/aseta-salasana page has not been built yet (Phase 4) \u2014 for now, this endpoint just confirms the schema and seeding logic work. The token is stored in D1 and will be usable once the page exists."
    });
  } catch (err) {
    console.error("seed-superadmin error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
}
__name(onRequestPost11, "onRequestPost");
async function onRequestOptions14() {
  return corsOptionsResponse();
}
__name(onRequestOptions14, "onRequestOptions");

// api/auth/users.js
var VALID_ROLES2 = ["admin", "editor"];
var VALID_PERMS = [
  "tarkista",
  "lahetakuva",
  "hallitse_galleriaa",
  "hallitse_artikkeleita",
  "admin_iam"
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
      admin_iam: !!row.perm_admin_iam
    },
    is_active: !!row.is_active,
    has_password: !!row.has_password,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    last_recovery_at: row.last_recovery_at
  };
}
__name(rowToUser, "rowToUser");
async function onRequestGet6({ request, env }) {
  await runInit(env);
  const auth = await requireAuth(request, env, "admin_iam");
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
    users: (results || []).map(rowToUser)
  });
}
__name(onRequestGet6, "onRequestGet");
async function onRequestPost12({ request, env }) {
  await runInit(env);
  const auth = await requireAuth(request, env, "admin_iam");
  if (auth.error) return errorResponse(auth.error, auth.status);
  const body = await getJsonBody(request);
  if (!body) return errorResponse("Virheellinen pyynt\xF6", 400);
  const firstNameErr = validateName(body.first_name, "Etunimi");
  if (firstNameErr) return errorResponse(firstNameErr, 400);
  const lastNameErr = validateName(body.last_name, "Sukunimi");
  if (lastNameErr) return errorResponse(lastNameErr, 400);
  const email = normalizeEmail(body.email);
  const emailErr = validateEmail(email);
  if (emailErr) return errorResponse(emailErr, 400);
  if (!VALID_ROLES2.includes(body.role)) {
    return errorResponse("Rooli on virheellinen", 400);
  }
  const perms = body.permissions || {};
  const permFlags = {};
  for (const p of VALID_PERMS) {
    permFlags[p] = perms[p] ? 1 : 0;
  }
  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (existing) {
    return errorResponse("S\xE4hk\xF6posti on jo k\xE4yt\xF6ss\xE4", 409);
  }
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
    permFlags.tarkista,
    permFlags.lahetakuva,
    permFlags.hallitse_galleriaa,
    permFlags.hallitse_artikkeleita,
    permFlags.admin_iam,
    auth.user.id
  ).run();
  const userId = insert.meta.last_row_id;
  if (!userId) return errorResponse("K\xE4ytt\xE4j\xE4n luonti ep\xE4onnistui", 500);
  const { rawToken, tokenHash } = await generateToken();
  const expiresAt = new Date(Date.now() + PROVISIONING_TOKEN_TTL_SECONDS * 1e3).toISOString();
  await env.DB.prepare(`
    INSERT INTO provisioning_tokens (token_hash, user_id, purpose, expires_at, created_by)
    VALUES (?, ?, 'initial_provision', ?, ?)
  `).bind(tokenHash, userId, expiresAt, auth.user.id).run();
  const url = new URL(request.url);
  const provisioningLink = `${url.protocol}//${url.host}/fi/aseta-salasana?token=${rawToken}`;
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
    expires_at: expiresAt
  });
}
__name(onRequestPost12, "onRequestPost");
async function onRequestOptions15() {
  return corsOptionsResponse();
}
__name(onRequestOptions15, "onRequestOptions");

// api/auth/validate-token.js
async function onRequestGet7({ request, env }) {
  await runInit(env);
  const url = new URL(request.url);
  const rawToken = url.searchParams.get("token");
  if (!rawToken) return errorResponse("Token puuttuu", 400);
  const tokenHash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    `SELECT t.purpose, t.expires_at, t.used_at,
            u.id AS user_id, u.first_name, u.last_name, u.email, u.is_active
     FROM provisioning_tokens t
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?`
  ).bind(tokenHash).first();
  if (!row) {
    return errorResponse("Linkki on virheellinen tai vanhentunut", 410);
  }
  if (row.used_at) {
    return errorResponse("Linkki on jo k\xE4ytetty", 410);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return errorResponse("Linkki on vanhentunut", 410);
  }
  if (!row.is_active) {
    return errorResponse("Tili ei ole k\xE4yt\xF6ss\xE4", 410);
  }
  return jsonResponse({
    valid: true,
    user: {
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email
    },
    purpose: row.purpose
  });
}
__name(onRequestGet7, "onRequestGet");
async function onRequestOptions16() {
  return corsOptionsResponse();
}
__name(onRequestOptions16, "onRequestOptions");

// api/mystery/admin.js
var ACTION_PERMISSIONS = {
  update_meta: "tarkista",
  set_status: "tarkista",
  delete_photo: "tarkista",
  delete_comment: "tarkista"
};
async function onRequestPost13(context) {
  const { request, env } = context;
  const h = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const body = await request.json();
    const action = body.action;
    const requiredPerm = ACTION_PERMISSIONS[action];
    if (!requiredPerm) {
      return new Response(JSON.stringify({ error: "Tuntematon" }), { status: 400, headers: h });
    }
    const auth = await requireAuthOrLegacyPassword(request, env, requiredPerm, body.password);
    if (auth.error) {
      return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: h });
    }
    switch (action) {
      case "update_meta": {
        const { photo_id, year_estimate, people, location_notes, notes } = body;
        const cur = await env.DB.prepare("SELECT status FROM photos WHERE id=?").bind(photo_id).first();
        const core = [year_estimate, people, location_notes];
        const filled = core.filter((f) => f && String(f).trim()).length;
        let status;
        if (cur && cur.status === "archived") {
          status = "archived";
        } else {
          status = filled === 0 ? "new" : filled < 3 ? "partial" : "identified";
        }
        await env.DB.prepare(`UPDATE photos SET year_estimate=?,people=?,location_notes=?,notes=?,status=? WHERE id=?`).bind(year_estimate || "", people || "", location_notes || "", notes || "", status, photo_id).run();
        return new Response(JSON.stringify({ success: true, status }), { headers: h });
      }
      case "set_status": {
        const { photo_id, status } = body;
        if (!["new", "partial", "identified", "archived"].includes(status))
          return new Response(JSON.stringify({ error: "Virhe" }), { status: 400, headers: h });
        await env.DB.prepare("UPDATE photos SET status=? WHERE id=?").bind(status, photo_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: h });
      }
      case "delete_photo": {
        await env.DB.prepare("DELETE FROM comments WHERE photo_id=?").bind(body.photo_id).run();
        await env.DB.prepare("DELETE FROM photos WHERE id=?").bind(body.photo_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: h });
      }
      case "delete_comment": {
        await env.DB.prepare("DELETE FROM comments WHERE parent_id=?").bind(body.comment_id).run();
        await env.DB.prepare("DELETE FROM comments WHERE id=?").bind(body.comment_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: h });
      }
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: h });
  }
}
__name(onRequestPost13, "onRequestPost");
async function onRequestOptions17() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
}
__name(onRequestOptions17, "onRequestOptions");

// api/mystery/comment.js
async function onRequestPost14(context) {
  const { request, env } = context;
  const h = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const { photo_id, author_name, content, field_type, parent_id } = await request.json();
    if (!photo_id || !content || content.trim().length < 2)
      return new Response(JSON.stringify({ error: "Liian lyhyt" }), { status: 400, headers: h });
    const name = (author_name || "Nimet\xF6n").trim().substring(0, 100);
    const text = content.trim().substring(0, 2e3);
    const field = ["general", "year", "people", "location", "notes"].includes(field_type) ? field_type : "general";
    const pid = parent_id ? parseInt(parent_id) : null;
    const r = await env.DB.prepare(
      `INSERT INTO comments (photo_id,author_name,field_type,content,parent_id) VALUES (?,?,?,?,?)`
    ).bind(photo_id, name, field, text, pid).run();
    const photo = await env.DB.prepare("SELECT status FROM photos WHERE id = ?").bind(photo_id).first();
    if (photo && photo.status === "new")
      await env.DB.prepare(`UPDATE photos SET status = 'partial' WHERE id = ?`).bind(photo_id).run();
    return new Response(JSON.stringify({ success: true, id: r.meta.last_row_id }), { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: h });
  }
}
__name(onRequestPost14, "onRequestPost");
async function onRequestOptions18() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
}
__name(onRequestOptions18, "onRequestOptions");

// api/mystery/featured.js
async function onRequestGet8(context) {
  const { env } = context;
  const h = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    // Cache for 60s on the edge — this endpoint hits the landing page on every visit,
    // and the answer barely changes. Reduces D1 load for high-traffic days.
    "Cache-Control": "public, max-age=60"
  };
  try {
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM photos
       WHERE status != 'identified'
         AND published_to_gallery_at IS NULL`
    ).first();
    const count = countRow ? countRow.c || 0 : 0;
    const rs = await env.DB.prepare(
      `SELECT id, thumb_data FROM photos
       WHERE status != 'identified'
         AND published_to_gallery_at IS NULL
         AND thumb_data IS NOT NULL
         AND thumb_data != ''
       ORDER BY RANDOM()
       LIMIT 6`
    ).all();
    const photos = (rs.results || []).map((r) => ({
      id: r.id,
      thumb_data: r.thumb_data
    }));
    return new Response(JSON.stringify({ count, photos }), { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, count: 0, photos: [] }), { status: 500, headers: h });
  }
}
__name(onRequestGet8, "onRequestGet");
async function onRequestOptions19() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
__name(onRequestOptions19, "onRequestOptions");

// api/mystery/galleries.js
var ALLOWED_BRANCHES = /* @__PURE__ */ new Set(["dev", "main"]);
async function onRequestGet9(context) {
  return handleRequest(context);
}
__name(onRequestGet9, "onRequestGet");
async function onRequestPost15(context) {
  return handleRequest(context);
}
__name(onRequestPost15, "onRequestPost");
async function handleRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const headerPw = request.headers.get("X-Admin-Password") || "";
  const queryPw = url.searchParams.get("password") || "";
  const legacyPassword = headerPw || queryPw;
  const auth = await requireAuthOrLegacyPassword(request, env, "hallitse_galleriaa", legacyPassword);
  if (auth.error) {
    return json({ error: auth.error }, auth.status);
  }
  const branch = env.CF_PAGES_BRANCH === "main" ? "main" : "dev";
  if (!ALLOWED_BRANCHES.has(branch)) {
    return json({ error: "Invalid branch context" }, 500);
  }
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return json({ error: "GitHub App credentials not configured" }, 500);
  }
  const cacheKey = new Request(`https://galleries-cache.internal/${branch}`, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.text();
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Cache": "HIT" }
    });
  }
  let token;
  try {
    token = await getInstallationToken(env);
  } catch (e) {
    return json({ error: "GitHub auth failed: " + e.message }, 500);
  }
  const owner = "photoandmoto";
  const repo = "photoandmoto";
  const dirPath = "src/content/galleries";
  let dirItems;
  try {
    const listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
    const r = await fetch(listUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "photoandmoto-publisher"
      }
    });
    if (!r.ok) {
      const text = await r.text();
      return json({ error: `GitHub list failed: ${r.status} ${text}` }, 502);
    }
    dirItems = await r.json();
  } catch (e) {
    return json({ error: "GitHub list error: " + e.message }, 502);
  }
  const manifestFiles = (Array.isArray(dirItems) ? dirItems : []).filter((f) => f.type === "file" && f.name.endsWith(".json"));
  const galleries = await Promise.all(manifestFiles.map(async (f) => {
    const slug = f.name.replace(/\.json$/, "");
    let title = formatTitleFromSlug(slug);
    try {
      const blobUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}/${f.name}?ref=${branch}`;
      const r = await fetch(blobUrl, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "photoandmoto-publisher"
        }
      });
      if (r.ok) {
        const meta = await r.json();
        const decoded = atob((meta.content || "").replace(/\n/g, ""));
        const manifest = JSON.parse(decoded);
        if (manifest && typeof manifest.title === "string" && manifest.title.trim()) {
          title = manifest.title.trim();
        }
      }
    } catch {
    }
    return { slug, title };
  }));
  galleries.sort((a, b) => a.title.localeCompare(b.title, "fi"));
  const responseBody = JSON.stringify({ galleries });
  const cacheableResponse = new Response(responseBody, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60"
    }
  });
  await cache.put(cacheKey, cacheableResponse.clone());
  return new Response(responseBody, {
    status: 200,
    headers: { "Content-Type": "application/json", "X-Cache": "MISS" }
  });
}
__name(handleRequest, "handleRequest");
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json, "json");
function formatTitleFromSlug(slug) {
  const roman = /* @__PURE__ */ new Set(["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]);
  return slug.split("-").map((w) => {
    if (roman.has(w.toLowerCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}
__name(formatTitleFromSlug, "formatTitleFromSlug");
async function getInstallationToken(env) {
  const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const r = await fetch(
    `https://api.github.com/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${jwt}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "photoandmoto-publisher"
      }
    }
  );
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`installation token request failed: ${r.status} ${text}`);
  }
  const data = await r.json();
  return data.token;
}
__name(getInstallationToken, "getInstallationToken");
async function signAppJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1e3);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: String(appId)
  };
  const encHeader = b64urlEncodeJson(header);
  const encPayload = b64urlEncodeJson(payload);
  const signingInput = `${encHeader}.${encPayload}`;
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );
  const encSig = b64urlEncode(new Uint8Array(sig));
  return `${signingInput}.${encSig}`;
}
__name(signAppJwt, "signAppJwt");
async function importPrivateKey(pem) {
  const cleaned = pem.replace(/-----BEGIN [A-Z ]+-----/g, "").replace(/-----END [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = base64ToBytes2(cleaned);
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch {
    const wrapped = wrapPkcs1AsPkcs8(der);
    return await crypto.subtle.importKey(
      "pkcs8",
      wrapped,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }
}
__name(importPrivateKey, "importPrivateKey");
function wrapPkcs1AsPkcs8(pkcs1) {
  const rsaOid = new Uint8Array([
    48,
    13,
    // SEQUENCE, len 13
    6,
    9,
    // OID, len 9
    42,
    134,
    72,
    134,
    247,
    13,
    1,
    1,
    1,
    // 1.2.840.113549.1.1.1
    5,
    0
    // NULL
  ]);
  const version = new Uint8Array([2, 1, 0]);
  const octetHeader = derLengthHeader(4, pkcs1.length);
  const octetString = concat(octetHeader, pkcs1);
  const inner = concat(version, rsaOid, octetString);
  const outerHeader = derLengthHeader(48, inner.length);
  return concat(outerHeader, inner);
}
__name(wrapPkcs1AsPkcs8, "wrapPkcs1AsPkcs8");
function derLengthHeader(tag, len) {
  if (len < 128) return new Uint8Array([tag, len]);
  if (len < 256) return new Uint8Array([tag, 129, len]);
  if (len < 65536) return new Uint8Array([tag, 130, len >> 8 & 255, len & 255]);
  return new Uint8Array([tag, 131, len >> 16 & 255, len >> 8 & 255, len & 255]);
}
__name(derLengthHeader, "derLengthHeader");
function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
__name(concat, "concat");
function base64ToBytes2(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(base64ToBytes2, "base64ToBytes");
function b64urlEncode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(b64urlEncode, "b64urlEncode");
function b64urlEncodeJson(obj) {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}
__name(b64urlEncodeJson, "b64urlEncodeJson");

// api/mystery/gallery-manage.js
function jsonResponse2(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
__name(jsonResponse2, "jsonResponse");
function badRequest(msg) {
  return jsonResponse2({ error: msg }, 400);
}
__name(badRequest, "badRequest");
function serverError(msg) {
  return jsonResponse2({ error: msg || "Server error" }, 500);
}
__name(serverError, "serverError");
function base64ToBytes3(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(base64ToBytes3, "base64ToBytes");
function bytesToBase642(bytes) {
  const CHUNK = 32768;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK)
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(out);
}
__name(bytesToBase642, "bytesToBase64");
function utf8ToBase64(str) {
  return bytesToBase642(new TextEncoder().encode(str));
}
__name(utf8ToBase64, "utf8ToBase64");
function bytesToBase64Url2(bytes) {
  return bytesToBase642(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(bytesToBase64Url2, "bytesToBase64Url");
function utf8ToBase64Url(str) {
  return bytesToBase64Url2(new TextEncoder().encode(str));
}
__name(utf8ToBase64Url, "utf8ToBase64Url");
async function importPrivateKey2(pem) {
  const cleaned = pem.replace(/-----BEGIN [A-Z ]+-----/g, "").replace(/-----END [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = base64ToBytes3(cleaned);
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch {
    const rsaOid = new Uint8Array([48, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1, 5, 0]);
    const version = new Uint8Array([2, 1, 0]);
    const octetLen = der.length;
    const octetHdr = octetLen < 128 ? new Uint8Array([4, octetLen]) : octetLen < 256 ? new Uint8Array([4, 129, octetLen]) : new Uint8Array([4, 130, octetLen >> 8 & 255, octetLen & 255]);
    const inner = concat2(version, rsaOid, octetHdr, der);
    const outerLen = inner.length;
    const outerHdr = outerLen < 128 ? new Uint8Array([48, outerLen]) : outerLen < 256 ? new Uint8Array([48, 129, outerLen]) : new Uint8Array([48, 130, outerLen >> 8 & 255, outerLen & 255]);
    const wrapped = concat2(outerHdr, inner);
    return await crypto.subtle.importKey(
      "pkcs8",
      wrapped,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }
}
__name(importPrivateKey2, "importPrivateKey");
function concat2(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
__name(concat2, "concat");
async function signAppJwt2(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1e3);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 8 * 60, iss: String(appId) };
  const h = utf8ToBase64Url(JSON.stringify(header));
  const p = utf8ToBase64Url(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  const key = await importPrivateKey2(privateKeyPem);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToBase64Url2(new Uint8Array(sig))}`;
}
__name(signAppJwt2, "signAppJwt");
async function getInstallationToken2(env) {
  const jwt = await signAppJwt2(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const r = await fetch(
    `https://api.github.com/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
    { method: "POST", headers: {
      "Authorization": `Bearer ${jwt}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "photoandmoto-publisher"
    } }
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`token: ${r.status} ${t}`);
  }
  return (await r.json()).token;
}
__name(getInstallationToken2, "getInstallationToken");
var OWNER = "photoandmoto";
var REPO = "photoandmoto";
async function gh(token, path, init = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "photoandmoto-publisher",
      "Content-Type": "application/json",
      ...init.headers || {}
    }
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GH ${path} \u2192 ${r.status}: ${t}`);
  }
  return r.json();
}
__name(gh, "gh");
async function getBranchHead(token, branch) {
  const ref = await gh(token, `/repos/${OWNER}/${REPO}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}
__name(getBranchHead, "getBranchHead");
async function getCommit(token, sha) {
  return gh(token, `/repos/${OWNER}/${REPO}/git/commits/${sha}`);
}
__name(getCommit, "getCommit");
async function createBlob(token, contentBase64) {
  return gh(token, `/repos/${OWNER}/${REPO}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: contentBase64, encoding: "base64" })
  });
}
__name(createBlob, "createBlob");
async function createTree(token, baseTreeSha, entries) {
  return gh(token, `/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries })
  });
}
__name(createTree, "createTree");
async function createCommit(token, message, treeSha, parentSha) {
  return gh(token, `/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] })
  });
}
__name(createCommit, "createCommit");
async function updateBranch(token, branch, commitSha) {
  return gh(token, `/repos/${OWNER}/${REPO}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitSha, force: false })
  });
}
__name(updateBranch, "updateBranch");
async function fetchFile(token, branch, filePath) {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  const data = await gh(token, `/repos/${OWNER}/${REPO}/contents/${encoded}?ref=${encodeURIComponent(branch)}`);
  return { content: (data.content || "").replace(/\n/g, ""), sha: data.sha };
}
__name(fetchFile, "fetchFile");
async function fetchManifest(token, branch, slug) {
  const path = `src/content/galleries/${slug}.json`;
  const { content } = await fetchFile(token, branch, path);
  const bytes = base64ToBytes3(content);
  const decoded = new TextDecoder("utf-8").decode(bytes);
  return JSON.parse(decoded);
}
__name(fetchManifest, "fetchManifest");
async function commitChanges(token, branch, message, fileChanges) {
  const headSha = await getBranchHead(token, branch);
  const headCommit = await getCommit(token, headSha);
  const baseTree = headCommit.tree.sha;
  const treeEntries = await Promise.all(fileChanges.map(async (fc) => {
    if (fc.base64Content === null) {
      return { path: fc.path, mode: "100644", type: "blob", sha: null };
    } else {
      const blob = await createBlob(token, fc.base64Content);
      return { path: fc.path, mode: "100644", type: "blob", sha: blob.sha };
    }
  }));
  const newTree = await createTree(token, baseTree, treeEntries);
  const newCommit = await createCommit(token, message, newTree.sha, headSha);
  return updateBranch(token, branch, newCommit.sha);
}
__name(commitChanges, "commitChanges");
function targetBranch(env) {
  const b = env.CF_PAGES_BRANCH || env.CF_PAGES_TARGET_BRANCH || "";
  return b === "main" ? "main" : "dev";
}
__name(targetBranch, "targetBranch");
function sanitizeSlug(slug) {
  return String(slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
__name(sanitizeSlug, "sanitizeSlug");
async function actionListGalleryPhotos(token, branch, slug) {
  const manifest = await fetchManifest(token, branch, slug);
  return jsonResponse2({
    success: true,
    title: manifest.title,
    slug,
    photos: (manifest.images || []).map((img) => ({
      filename: img.filename,
      caption: img.caption || img.filename,
      thumb: img.thumb,
      display: img.display,
      date: img.date || ""
    }))
  });
}
__name(actionListGalleryPhotos, "actionListGalleryPhotos");
async function actionDeletePhoto(token, branch, slug, filename) {
  const manifest = await fetchManifest(token, branch, slug);
  const idx = manifest.images.findIndex((i) => i.filename === filename);
  if (idx === -1) return badRequest(`Photo "${filename}" not found in ${slug}`);
  const entry = manifest.images[idx];
  manifest.images.splice(idx, 1);
  if (manifest.cover_image === entry.thumb && manifest.images.length > 0) {
    manifest.cover_image = manifest.images[0].thumb;
  }
  const base = `public/galleries/${slug}`;
  const changes = [
    // Delete original
    { path: `${base}/${filename}`, base64Content: null },
    // Delete thumb
    { path: `${base}/${entry.thumb}`, base64Content: null },
    // Delete display
    { path: `${base}/${entry.display}`, base64Content: null },
    // Update manifest
    {
      path: `src/content/galleries/${slug}.json`,
      base64Content: utf8ToBase64(JSON.stringify(manifest, null, 2) + "\n")
    }
  ];
  await commitChanges(token, branch, `Gallery: delete photo "${filename}" from ${slug}`, changes);
  return jsonResponse2({ success: true, slug, deleted: filename });
}
__name(actionDeletePhoto, "actionDeletePhoto");
async function actionUpdateCaption(token, branch, slug, filename, newCaption) {
  const manifest = await fetchManifest(token, branch, slug);
  const entry = manifest.images.find((i) => i.filename === filename);
  if (!entry) return badRequest(`Photo "${filename}" not found in ${slug}`);
  entry.caption = newCaption.trim();
  const changes = [{
    path: `src/content/galleries/${slug}.json`,
    base64Content: utf8ToBase64(JSON.stringify(manifest, null, 2) + "\n")
  }];
  await commitChanges(token, branch, `Gallery: update caption for "${filename}" in ${slug}`, changes);
  return jsonResponse2({ success: true, slug, filename, caption: entry.caption });
}
__name(actionUpdateCaption, "actionUpdateCaption");
async function actionDeleteGallery(token, branch, slug) {
  const changes = [{
    path: `src/content/galleries/${slug}.json`,
    base64Content: null
  }];
  await commitChanges(token, branch, `Gallery: delete gallery "${slug}"`, changes);
  return jsonResponse2({ success: true, slug });
}
__name(actionDeleteGallery, "actionDeleteGallery");
async function actionRenameGallery(token, branch, slug, newTitle) {
  const manifest = await fetchManifest(token, branch, slug);
  manifest.title = newTitle.trim();
  const changes = [{
    path: `src/content/galleries/${slug}.json`,
    base64Content: utf8ToBase64(JSON.stringify(manifest, null, 2) + "\n")
  }];
  await commitChanges(token, branch, `Gallery: rename "${slug}" \u2192 "${newTitle}"`, changes);
  return jsonResponse2({ success: true, slug, title: manifest.title });
}
__name(actionRenameGallery, "actionRenameGallery");
async function actionMovePhoto(token, branch, sourceSlug, filename, targetSlug) {
  if (sourceSlug === targetSlug) {
    return badRequest("Source and target galleries are the same");
  }
  const sourceManifest = await fetchManifest(token, branch, sourceSlug);
  const targetManifest = await fetchManifest(token, branch, targetSlug);
  const idx = sourceManifest.images.findIndex((i) => i.filename === filename);
  if (idx === -1) return badRequest(`Photo "${filename}" not found in ${sourceSlug}`);
  const entry = sourceManifest.images[idx];
  if (targetManifest.images.some((i) => i.filename === filename)) {
    return badRequest(`Photo "${filename}" already exists in target gallery "${targetSlug}"`);
  }
  const sourceBase = `public/galleries/${sourceSlug}`;
  const targetBase = `public/galleries/${targetSlug}`;
  let origFile = null;
  try {
    origFile = await fetchFile(token, branch, `${sourceBase}/${filename}`);
  } catch (e) {
    if (e.message && e.message.includes("404")) {
      console.log(`Note: original "${filename}" not found in ${sourceSlug}, moving thumb+display only`);
    } else {
      throw e;
    }
  }
  const [thumbFile, displayFile] = await Promise.all([
    fetchFile(token, branch, `${sourceBase}/${entry.thumb}`),
    fetchFile(token, branch, `${sourceBase}/${entry.display}`)
  ]);
  const newEntry = { ...entry };
  sourceManifest.images.splice(idx, 1);
  if (sourceManifest.cover_image === entry.thumb && sourceManifest.images.length > 0) {
    sourceManifest.cover_image = sourceManifest.images[0].thumb;
  }
  targetManifest.images.push(newEntry);
  const changes = [];
  if (origFile) {
    changes.push({ path: `${targetBase}/${filename}`, base64Content: origFile.content });
    changes.push({ path: `${sourceBase}/${filename}`, base64Content: null });
  }
  changes.push({ path: `${targetBase}/${entry.thumb}`, base64Content: thumbFile.content });
  changes.push({ path: `${targetBase}/${entry.display}`, base64Content: displayFile.content });
  changes.push({ path: `${sourceBase}/${entry.thumb}`, base64Content: null });
  changes.push({ path: `${sourceBase}/${entry.display}`, base64Content: null });
  changes.push({
    path: `src/content/galleries/${sourceSlug}.json`,
    base64Content: utf8ToBase64(JSON.stringify(sourceManifest, null, 2) + "\n")
  });
  changes.push({
    path: `src/content/galleries/${targetSlug}.json`,
    base64Content: utf8ToBase64(JSON.stringify(targetManifest, null, 2) + "\n")
  });
  const message = `chore(gallery): move "${filename}" from ${sourceSlug} to ${targetSlug}`;
  await commitChanges(token, branch, message, changes);
  return jsonResponse2({
    success: true,
    filename,
    source: sourceSlug,
    target: targetSlug
  });
}
__name(actionMovePhoto, "actionMovePhoto");
async function onRequestPost16({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!env.UPLOAD_PASSWORD && !request.headers.get("cookie")) return serverError("UPLOAD_PASSWORD not configured");
  const auth = await requireAuthOrLegacyPassword(request, env, "hallitse_galleriaa", body.password || "");
  if (auth.error) return jsonResponse2({ error: auth.error }, auth.status);
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY)
    return serverError("GitHub App secrets missing");
  const slug = sanitizeSlug(body.gallery_slug);
  if (!slug) return badRequest("gallery_slug required");
  const action = body.action || "";
  const branch = targetBranch(env);
  let token;
  try {
    token = await getInstallationToken2(env);
  } catch (e) {
    return serverError(`GitHub auth failed: ${e.message}`);
  }
  try {
    switch (action) {
      case "list_gallery_photos":
        return await actionListGalleryPhotos(token, branch, slug);
      case "delete_photo": {
        const filename = (body.filename || "").trim();
        if (!filename) return badRequest("filename required");
        return await actionDeletePhoto(token, branch, slug, filename);
      }
      case "update_caption": {
        const filename = (body.filename || "").trim();
        const newCaption = (body.caption || "").trim();
        if (!filename) return badRequest("filename required");
        if (!newCaption) return badRequest("caption required");
        return await actionUpdateCaption(token, branch, slug, filename, newCaption);
      }
      case "delete_gallery":
        return await actionDeleteGallery(token, branch, slug);
      case "rename_gallery": {
        const newTitle = (body.title || "").trim();
        if (!newTitle) return badRequest("title required");
        return await actionRenameGallery(token, branch, slug, newTitle);
      }
      case "move_photo": {
        const filename = (body.filename || "").trim();
        const targetSlug = sanitizeSlug(body.target_slug);
        if (!filename) return badRequest("filename required");
        if (!targetSlug) return badRequest("target_slug required");
        return await actionMovePhoto(token, branch, slug, filename, targetSlug);
      }
      default:
        return badRequest(`Unknown action: ${action}`);
    }
  } catch (e) {
    return serverError(`Action "${action}" failed: ${e.message}`);
  }
}
__name(onRequestPost16, "onRequestPost");

// api/mystery/init.js
async function onRequestPost17(context) {
  const { env } = context;
  const h = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, content_type TEXT DEFAULT 'image/jpeg', image_data TEXT NOT NULL, year_estimate TEXT DEFAULT '', people TEXT DEFAULT '', location_notes TEXT DEFAULT '', notes TEXT DEFAULT '', status TEXT DEFAULT 'new', created_at TEXT DEFAULT (datetime('now')))`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, photo_id INTEGER NOT NULL, parent_id INTEGER DEFAULT NULL, author_name TEXT DEFAULT 'Nimet\xF6n', field_type TEXT DEFAULT 'general', content TEXT NOT NULL, upvotes INTEGER DEFAULT 0, downvotes INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (photo_id) REFERENCES photos(id))`).run();
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_comments_photo ON comments(photo_id)`).run();
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status)`).run();
    const migs = [
      `ALTER TABLE comments ADD COLUMN field_type TEXT DEFAULT 'general'`,
      `ALTER TABLE comments ADD COLUMN upvotes INTEGER DEFAULT 0`,
      `ALTER TABLE comments ADD COLUMN downvotes INTEGER DEFAULT 0`,
      `ALTER TABLE comments ADD COLUMN parent_id INTEGER DEFAULT NULL`
    ];
    for (const sql of migs) {
      try {
        await env.DB.prepare(sql).run();
      } catch (e) {
      }
    }
    return new Response(JSON.stringify({ success: true }), { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: h });
  }
}
__name(onRequestPost17, "onRequestPost");

// api/mystery/photos.js
async function onRequestGet10(context) {
  const { request, env } = context;
  const h = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const url = new URL(request.url);
    const includeAll = url.searchParams.get("include") === "all";
    const whereSql = includeAll ? `WHERE status != 'archived'` : `WHERE status NOT IN ('archived','identified')`;
    const photos = await env.DB.prepare(
      `SELECT id,filename,content_type,year_estimate,people,location_notes,notes,status,created_at FROM photos ${whereSql} ORDER BY created_at DESC`
    ).all();
    const comments = await env.DB.prepare(`SELECT * FROM comments ORDER BY created_at ASC`).all();
    const byPhoto = {};
    for (const c of comments.results) {
      if (!byPhoto[c.photo_id]) byPhoto[c.photo_id] = [];
      byPhoto[c.photo_id].push(c);
    }
    const result = photos.results.map((p) => ({
      ...p,
      image_url: `/api/mystery/image/${p.id}`,
      comments: byPhoto[p.id] || []
    }));
    return new Response(JSON.stringify({ photos: result }), { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: h });
  }
}
__name(onRequestGet10, "onRequestGet");

// api/mystery/publish.js
function jsonResponse3(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
__name(jsonResponse3, "jsonResponse");
function badRequest2(msg) {
  return jsonResponse3({ error: msg }, 400);
}
__name(badRequest2, "badRequest");
function unauthorized(msg) {
  return jsonResponse3({ error: msg || "Unauthorized" }, 401);
}
__name(unauthorized, "unauthorized");
function notFound(msg) {
  return jsonResponse3({ error: msg || "Not found" }, 404);
}
__name(notFound, "notFound");
function serverError2(msg) {
  return jsonResponse3({ error: msg || "Server error" }, 500);
}
__name(serverError2, "serverError");
function base64ToBytes4(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
__name(base64ToBytes4, "base64ToBytes");
function bytesToBase643(bytes) {
  const CHUNK = 32768;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}
__name(bytesToBase643, "bytesToBase64");
function utf8ToBase642(str) {
  return bytesToBase643(new TextEncoder().encode(str));
}
__name(utf8ToBase642, "utf8ToBase64");
function bytesToBase64Url3(bytes) {
  return bytesToBase643(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(bytesToBase64Url3, "bytesToBase64Url");
function utf8ToBase64Url2(str) {
  return bytesToBase64Url3(new TextEncoder().encode(str));
}
__name(utf8ToBase64Url2, "utf8ToBase64Url");
function buildFilename(people, location, year) {
  const parts = [people, location, year].map((s) => (s || "").trim()).filter(Boolean);
  let base = parts.join(" ");
  base = base.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  if (!base) base = "untitled";
  return `${base}.jpg`;
}
__name(buildFilename, "buildFilename");
function sanitizeSlug2(slug) {
  return String(slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
__name(sanitizeSlug2, "sanitizeSlug");
function formatTitleFromSlug2(slug) {
  const romanNumerals = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
  return slug.split("-").map((w) => {
    if (romanNumerals.includes(w.toLowerCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}
__name(formatTitleFromSlug2, "formatTitleFromSlug");
function determineCategory(slug) {
  if (slug.includes("international")) return "international";
  if (slug.includes("suomi") || slug.includes("finland")) return "finland";
  if (slug.includes("enduro")) return "enduro";
  if (slug.includes("scramble")) return "scramble";
  if (slug.includes("black")) return "black-white";
  return "international";
}
__name(determineCategory, "determineCategory");
async function importPrivateKey3(pemString) {
  const pem = pemString.replace(/-----BEGIN [A-Z ]+-----/g, "").replace(/-----END [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = base64ToBytes4(pem);
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch (e) {
    const pkcs8Header = new Uint8Array([
      48,
      130,
      0,
      0,
      // SEQUENCE, length placeholder (overwritten below)
      2,
      1,
      0,
      // INTEGER 0 (version)
      48,
      13,
      // SEQUENCE (algorithm identifier)
      6,
      9,
      42,
      134,
      72,
      134,
      247,
      13,
      1,
      1,
      1,
      // OID rsaEncryption
      5,
      0,
      // NULL params
      4,
      130,
      0,
      0
      // OCTET STRING (length placeholder)
    ]);
    const totalLen = pkcs8Header.length + der.length;
    const inner = der.length;
    pkcs8Header[2] = totalLen - 4 >> 8 & 255;
    pkcs8Header[3] = totalLen - 4 & 255;
    pkcs8Header[pkcs8Header.length - 2] = inner >> 8 & 255;
    pkcs8Header[pkcs8Header.length - 1] = inner & 255;
    const wrapped = new Uint8Array(totalLen);
    wrapped.set(pkcs8Header, 0);
    wrapped.set(der, pkcs8Header.length);
    return await crypto.subtle.importKey(
      "pkcs8",
      wrapped,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }
}
__name(importPrivateKey3, "importPrivateKey");
async function signAppJwt3(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1e3);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 8 * 60, iss: String(appId) };
  const headerB64 = utf8ToBase64Url2(JSON.stringify(header));
  const payloadB64 = utf8ToBase64Url2(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importPrivateKey3(privateKeyPem);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${bytesToBase64Url3(new Uint8Array(sig))}`;
}
__name(signAppJwt3, "signAppJwt");
async function getInstallationToken3(appJwt, installationId) {
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${appJwt}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "photoandmoto-publisher"
      }
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Installation token request failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.token;
}
__name(getInstallationToken3, "getInstallationToken");
var REPO_OWNER = "photoandmoto";
var REPO_NAME = "photoandmoto";
async function gh2(token, path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "photoandmoto-publisher",
      "Content-Type": "application/json",
      ...init.headers || {}
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${init.method || "GET"} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}
__name(gh2, "gh");
async function getBranchHead2(token, branch) {
  const ref = await gh2(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}
__name(getBranchHead2, "getBranchHead");
async function getCommit2(token, commitSha) {
  return gh2(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${commitSha}`);
}
__name(getCommit2, "getCommit");
async function createBlob2(token, contentBase64) {
  return gh2(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: contentBase64, encoding: "base64" })
  });
}
__name(createBlob2, "createBlob");
async function createTree2(token, baseTreeSha, entries) {
  return gh2(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries })
  });
}
__name(createTree2, "createTree");
async function createCommit2(token, message, treeSha, parentSha) {
  return gh2(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] })
  });
}
__name(createCommit2, "createCommit");
async function updateBranch2(token, branch, commitSha) {
  return gh2(token, `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitSha, force: false })
  });
}
__name(updateBranch2, "updateBranch");
async function fileExists(token, branch, path) {
  const url = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(`https://api.github.com${url}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "photoandmoto-publisher"
    }
  });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  const text = await res.text();
  throw new Error(`GitHub contents check failed (${res.status}): ${text}`);
}
__name(fileExists, "fileExists");
function targetBranch2(env) {
  const b = env.CF_PAGES_BRANCH || env.CF_PAGES_TARGET_BRANCH || "";
  if (b === "main") return "main";
  return "dev";
}
__name(targetBranch2, "targetBranch");
async function onRequestPost18({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest2("Invalid JSON body");
  }
  const legacyPassword = body.password || request.headers.get("X-Admin-Password") || "";
  const auth = await requireAuthOrLegacyPassword(request, env, "hallitse_galleriaa", legacyPassword);
  if (auth.error) return unauthorized(auth.error);
  if (!env.DB) return serverError2("D1 binding (DB) missing");
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return serverError2("GitHub App secrets missing");
  }
  const photoId = parseInt(body.photo_id, 10);
  if (!Number.isFinite(photoId) || photoId <= 0) return badRequest2("photo_id required");
  const slug = sanitizeSlug2(body.gallery_slug);
  if (!slug) return badRequest2("gallery_slug required");
  const createNew = !!body.create_new;
  const galleryTitle = (body.gallery_title || formatTitleFromSlug2(slug)).trim();
  let photo;
  try {
    photo = await env.DB.prepare("SELECT id, filename, image_data, year_estimate, people, location_notes, status, published_to_gallery_at FROM photos WHERE id = ?").bind(photoId).first();
  } catch (e) {
    return serverError2(`D1 read failed: ${e.message}`);
  }
  if (!photo) return notFound("Photo not found");
  if (photo.published_to_gallery_at) {
    return badRequest2("Photo already published \u2014 cannot publish twice");
  }
  if (photo.status !== "identified") {
    return badRequest2(`Photo status is "${photo.status}" \u2014 must be "identified"`);
  }
  let filename;
  if (body.filename_override && typeof body.filename_override === "string") {
    const cleaned = body.filename_override.trim().replace(/\.(jpg|jpeg|png|webp)$/i, "");
    filename = cleaned ? `${cleaned}.jpg` : buildFilename(photo.people, photo.location_notes, photo.year_estimate);
  } else {
    filename = buildFilename(photo.people, photo.location_notes, photo.year_estimate);
  }
  let imageBase64 = photo.image_data || "";
  const commaIdx = imageBase64.indexOf(",");
  if (imageBase64.startsWith("data:") && commaIdx !== -1) {
    imageBase64 = imageBase64.slice(commaIdx + 1);
  }
  if (!imageBase64) return badRequest2("Photo has no image data");
  let token;
  try {
    const appJwt = await signAppJwt3(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
    token = await getInstallationToken3(appJwt, env.GITHUB_APP_INSTALLATION_ID);
  } catch (e) {
    return serverError2(`GitHub auth failed: ${e.message}`);
  }
  const branch = targetBranch2(env);
  const imagePath = `public/galleries/${slug}/${filename}`;
  const manifestPath = `src/content/galleries/${slug}.json`;
  try {
    const exists = await fileExists(token, branch, imagePath);
    if (exists) {
      return badRequest2(`A photo named "${filename}" already exists in ${slug}. Edit the filename and try again.`);
    }
  } catch (e) {
    return serverError2(`Pre-flight check failed: ${e.message}`);
  }
  let commitResult;
  try {
    const headSha = await getBranchHead2(token, branch);
    const headCommit = await getCommit2(token, headSha);
    const baseTree = headCommit.tree.sha;
    const imageBlob = await createBlob2(token, imageBase64);
    const treeEntries = [
      { path: imagePath, mode: "100644", type: "blob", sha: imageBlob.sha }
    ];
    if (createNew) {
      const stub = {
        title: galleryTitle || formatTitleFromSlug2(slug),
        slug,
        description: `Photo gallery: ${galleryTitle || formatTitleFromSlug2(slug)}`,
        cover_image: "",
        images: [],
        category: determineCategory(slug)
      };
      const manifestBlob = await createBlob2(token, utf8ToBase642(JSON.stringify(stub, null, 2) + "\n"));
      treeEntries.push({ path: manifestPath, mode: "100644", type: "blob", sha: manifestBlob.sha });
    }
    const newTree = await createTree2(token, baseTree, treeEntries);
    const message = `Gallery: publish photo #${photoId} to ${slug}`;
    const newCommit = await createCommit2(token, message, newTree.sha, headSha);
    commitResult = await updateBranch2(token, branch, newCommit.sha);
  } catch (e) {
    return serverError2(`GitHub commit failed: ${e.message}`);
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  let cleanupWarning = null;
  try {
    await env.DB.prepare("UPDATE photos SET published_to_gallery_at = ? WHERE id = ?").bind(nowIso, photoId).run();
    await env.DB.prepare("DELETE FROM comments WHERE photo_id = ?").bind(photoId).run();
    await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(photoId).run();
  } catch (e) {
    cleanupWarning = `D1 cleanup failed: ${e.message}`;
  }
  return jsonResponse3({
    success: true,
    branch,
    commit_sha: commitResult.object?.sha || null,
    image_path: imagePath,
    gallery_slug: slug,
    filename,
    created_new_gallery: createNew,
    cleanup_warning: cleanupWarning
  });
}
__name(onRequestPost18, "onRequestPost");

// api/mystery/upload.js
async function onRequestPost19(context) {
  const { request, env } = context;
  const h = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const fd = await request.formData();
    const legacyPassword = fd.get("password") || "";
    const auth = await requireAuthOrLegacyPassword(request, env, "lahetakuva", legacyPassword);
    if (auth.error) {
      return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: h });
    }
    const file = fd.get("photo");
    if (!file || !file.size) return new Response(JSON.stringify({ error: "Kuvaa ei l\xF6ytynyt" }), { status: 400, headers: h });
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return new Response(JSON.stringify({ error: "Sallitut: JPEG, PNG, WEBP" }), { status: 400, headers: h });
    if (file.size > 5 * 1024 * 1024)
      return new Response(JSON.stringify({ error: "Max 5 MB" }), { status: 400, headers: h });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 8192)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    let thumbData = fd.get("thumb_data");
    if (thumbData && typeof thumbData === "string" && thumbData.length > 100 * 1024) {
      thumbData = null;
    }
    if (!thumbData) thumbData = null;
    const uploaderName = auth.user ? `${auth.user.first_name} ${auth.user.last_name}` : "Yll\xE4pito";
    const r = await env.DB.prepare(
      `INSERT INTO photos (filename,content_type,image_data,uploader_name,year_estimate,people,location_notes,notes,thumb_data) VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      file.name,
      file.type,
      btoa(bin),
      uploaderName,
      fd.get("year_estimate") || "",
      fd.get("people") || "",
      fd.get("location_notes") || "",
      fd.get("notes") || "",
      thumbData
    ).run();
    return new Response(JSON.stringify({ success: true, id: r.meta.last_row_id }), { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: h });
  }
}
__name(onRequestPost19, "onRequestPost");
async function onRequestOptions20() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
}
__name(onRequestOptions20, "onRequestOptions");

// api/mystery/verify.js
async function onRequestPost20(context) {
  const { request, env } = context;
  const h = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const { password } = await request.json();
    const valid = password && password === env.UPLOAD_PASSWORD;
    return new Response(JSON.stringify({ valid }), { status: valid ? 200 : 401, headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ valid: false }), { status: 500, headers: h });
  }
}
__name(onRequestPost20, "onRequestPost");
async function onRequestOptions21() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
}
__name(onRequestOptions21, "onRequestOptions");

// api/mystery/vote.js
async function onRequestPost21(context) {
  const { request, env } = context;
  const h = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const { comment_id, vote } = await request.json();
    if (!comment_id || ![-1, 1].includes(vote))
      return new Response(JSON.stringify({ error: "Virhe" }), { status: 400, headers: h });
    const col = vote === 1 ? "upvotes" : "downvotes";
    await env.DB.prepare(`UPDATE comments SET ${col} = ${col} + 1 WHERE id = ?`).bind(comment_id).run();
    const u = await env.DB.prepare("SELECT upvotes,downvotes FROM comments WHERE id = ?").bind(comment_id).first();
    return new Response(JSON.stringify({ success: true, upvotes: u.upvotes, downvotes: u.downvotes }), { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: h });
  }
}
__name(onRequestPost21, "onRequestPost");
async function onRequestOptions22() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
}
__name(onRequestOptions22, "onRequestOptions");

// api/search.js
async function onRequestPost22(context) {
  const { request, env } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  try {
    const { query, lang } = await request.json();
    if (!query || query.length < 2) {
      return new Response(JSON.stringify({ error: "Query too short" }), { status: 400, headers: corsHeaders });
    }
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not found in environment" }), { status: 500, headers: corsHeaders });
    }
    const isFinnish = lang === "fi" || /[äöå]|mitä|mikä|mik[sä]|kuka|missä|milloin|kerro|kuinka|onko|voiko|paljonko|miten|miksi|montako|kenen|minne/i.test(query);
    const languageInstruction = isFinnish ? "PAKOLLINEN S\xC4\xC4NT\xD6: Vastaa AINA SUOMEKSI. K\xE4ytt\xE4j\xE4 kysyy suomeksi ja odottaa vastausta suomeksi. \xC4l\xE4 koskaan vaihda englantiin, vaikka l\xE4hdeaineisto olisi englanniksi. K\xE4\xE4nn\xE4 kaikki sis\xE4lt\xF6 suomeksi." : "MANDATORY RULE: Always answer in ENGLISH. The user is asking in English and expects an English response.";
    let siteData = "[]";
    try {
      if (env.ASSETS) {
        const assetResponse = await env.ASSETS.fetch(new URL("/data/site-index.json", request.url));
        if (assetResponse.ok) {
          siteData = await assetResponse.text();
        } else {
          console.error(`Failed to load site data internally: HTTP ${assetResponse.status}`);
        }
      }
    } catch (e) {
      console.error("Failed to load site data internally:", e);
    }
    const trimmedData = siteData.substring(0, 8e4);
    const prompt = `You are the AI search assistant for Photo & Moto, a Finnish motorsport photography and history website.

${languageInstruction}

Answer questions based on the site data provided below. When a person is mentioned, check nicknames and variations (e.g. "Hessu Mikkola" = "Heikki Mikkola", "Magoo" = "Danny Chandler", "Carla" = "H\xE5kan Carlqvist"). Photo gallery captions contain rich information about people, places, and years.

Be concise but complete. If the data doesn't contain the answer, say so politely in the correct language.

REMEMBER: ${isFinnish ? "Vastaa SUOMEKSI. Kaikki vastaukset suomeksi, ei englantia." : "Answer in ENGLISH only."}

SITE DATA:
${trimmedData}

USER QUESTION: ${query}`;
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    const geminiResp = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.3 }
      })
    });
    const geminiText = await geminiResp.text();
    if (!geminiResp.ok) {
      return new Response(JSON.stringify({ error: "Gemini API error: " + geminiResp.status + " - " + geminiText.substring(0, 200) }), { headers: corsHeaders });
    }
    const geminiData = JSON.parse(geminiText);
    const answer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!answer) {
      return new Response(JSON.stringify({ error: "No answer from Gemini. Raw: " + geminiText.substring(0, 200) }), { headers: corsHeaders });
    }
    return new Response(JSON.stringify({ answer }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Function error: " + err.message }), { status: 500, headers: corsHeaders });
  }
}
__name(onRequestPost22, "onRequestPost");
async function onRequestOptions23() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
__name(onRequestOptions23, "onRequestOptions");

// oauth/auth.js
async function onRequestGet11({ request, env }) {
  if (!env.OAUTH_GITHUB_CLIENT_ID) {
    return new Response("OAUTH_GITHUB_CLIENT_ID not configured", { status: 500 });
  }
  const url = new URL(request.url);
  const redirectUri = env.OAUTH_REDIRECT_URI || `${url.origin}/oauth/callback`;
  const state = crypto.randomUUID();
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.OAUTH_GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "repo");
  authorizeUrl.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": authorizeUrl.toString(),
      "Set-Cookie": `decap_oauth_state=${state}; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      "Cache-Control": "no-store"
    }
  });
}
__name(onRequestGet11, "onRequestGet");

// oauth/callback.js
async function onRequestGet12({ request, env }) {
  if (!env.OAUTH_GITHUB_CLIENT_ID || !env.OAUTH_GITHUB_CLIENT_SECRET) {
    return errorPage("OAuth secrets not configured on the server.");
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const desc = url.searchParams.get("error_description") || oauthError;
    return errorPage(`GitHub returned an error: ${desc}`);
  }
  if (!code) {
    return errorPage("Missing `code` parameter from GitHub.");
  }
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookieState = (cookieHeader.match(/(?:^|;\s*)decap_oauth_state=([^;]+)/) || [])[1];
  if (!cookieState || !state || cookieState !== state) {
    return errorPage("State mismatch \u2014 possible CSRF, or the login attempt timed out. Try logging in again.");
  }
  let token;
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "photoandmoto-decap-oauth"
      },
      body: JSON.stringify({
        client_id: env.OAUTH_GITHUB_CLIENT_ID,
        client_secret: env.OAUTH_GITHUB_CLIENT_SECRET,
        code
      })
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return errorPage(`Token exchange failed (${tokenRes.status}): ${text}`);
    }
    const data = await tokenRes.json();
    if (data.error) {
      return errorPage(`GitHub: ${data.error_description || data.error}`);
    }
    token = data.access_token;
    if (!token) {
      return errorPage("GitHub did not return an access_token.");
    }
  } catch (e) {
    return errorPage(`Token exchange threw: ${e.message}`);
  }
  const payload = JSON.stringify({ token, provider: "github" });
  const html = `<!doctype html>
<html lang="fi"><head><meta charset="utf-8"><title>Kirjautuminen valmis\u2026</title>
<meta name="robots" content="noindex">
<style>body{font-family:system-ui,sans-serif;padding:2rem;color:#333}</style>
</head><body>
<p>Kirjautuminen valmis. T\xE4m\xE4 ikkuna sulkeutuu hetken kuluttua.</p>
<script>
(function() {
  var payload = ${JSON.stringify(payload)};
  function send(msg, origin) {
    if (window.opener) window.opener.postMessage(msg, origin || '*');
  }
  window.addEventListener('message', function(e) {
    if (typeof e.data !== 'string' || e.data.indexOf('authorizing:') !== 0) return;
    send('authorization:github:success:' + payload, e.origin);
    setTimeout(function(){ window.close(); }, 100);
  }, false);
  // Wake the opener up so it sets up its listener and replies.
  send('authorizing:github', '*');
})();
<\/script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Clear the state cookie — it's single-use.
      "Set-Cookie": "decap_oauth_state=; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    }
  });
}
__name(onRequestGet12, "onRequestGet");
function errorPage(msg) {
  const safe = String(msg).replace(/[<>&"]/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;"
  })[c]);
  const html = `<!doctype html>
<html lang="fi"><head><meta charset="utf-8"><title>OAuth-virhe</title>
<meta name="robots" content="noindex">
<style>body{font-family:system-ui,sans-serif;padding:2rem;color:#333;max-width:640px}
h1{color:#b00020}</style>
</head><body>
<h1>OAuth-virhe</h1>
<p>${safe}</p>
<p><a href="/admin/">Takaisin Decapiin</a></p>
</body></html>`;
  return new Response(html, {
    status: 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
__name(errorPage, "errorPage");

// api/auth/_middleware.js
async function onRequest(context) {
  try {
    return await context.next();
  } catch (err) {
    const message = err?.message || "Tuntematon virhe";
    const stack = err?.stack || "";
    console.error("AUTH ENDPOINT ERROR:", err);
    console.error("Stack:", stack);
    return new Response(
      JSON.stringify({
        error: message,
        // Include stack only on non-prod environments so debug is fast.
        // CF_PAGES_BRANCH === 'main' means production; anything else is staging/preview.
        ...context.env?.CF_PAGES_BRANCH !== "main" ? { stack } : {}
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
}
__name(onRequest, "onRequest");

// index.js
async function onRequest2(context) {
  const { request } = context;
  const url = new URL(request.url);
  const userAgent = (request.headers.get("User-Agent") || "").toLowerCase();
  const isBot = /bot|crawler|spider|scraper|googlebot|bingbot|yandex|baidu|duckduckbot|slurp|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|applebot/i.test(
    userAgent
  );
  if (isBot) {
    return Response.redirect(`${url.origin}/fi/`, 302);
  }
  const country = request.headers.get("CF-IPCountry") || "XX";
  const target = country === "FI" ? "/fi/" : "/en/";
  return Response.redirect(`${url.origin}${target}`, 302);
}
__name(onRequest2, "onRequest");

// ../.wrangler/tmp/pages-TZevjR/functionsRoutes-0.8058236420861445.mjs
var routes = [
  {
    routePath: "/api/auth/users/:id/deactivate",
    mountPath: "/api/auth/users/:id",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions2]
  },
  {
    routePath: "/api/auth/users/:id/deactivate",
    mountPath: "/api/auth/users/:id",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/auth/users/:id/regenerate-link",
    mountPath: "/api/auth/users/:id",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions3]
  },
  {
    routePath: "/api/auth/users/:id/regenerate-link",
    mountPath: "/api/auth/users/:id",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/auth/audit/recoveries",
    mountPath: "/api/auth/audit",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/auth/audit/recoveries",
    mountPath: "/api/auth/audit",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions4]
  },
  {
    routePath: "/api/auth/recovery/complete",
    mountPath: "/api/auth/recovery",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions5]
  },
  {
    routePath: "/api/auth/recovery/complete",
    mountPath: "/api/auth/recovery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/auth/recovery/start",
    mountPath: "/api/auth/recovery",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions6]
  },
  {
    routePath: "/api/auth/recovery/start",
    mountPath: "/api/auth/recovery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost5]
  },
  {
    routePath: "/api/auth/recovery/verify",
    mountPath: "/api/auth/recovery",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions7]
  },
  {
    routePath: "/api/auth/recovery/verify",
    mountPath: "/api/auth/recovery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost6]
  },
  {
    routePath: "/api/auth/users/:id",
    mountPath: "/api/auth/users",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions8]
  },
  {
    routePath: "/api/auth/users/:id",
    mountPath: "/api/auth/users",
    method: "PATCH",
    middlewares: [],
    modules: [onRequestPatch]
  },
  {
    routePath: "/api/mystery/image/:id",
    mountPath: "/api/mystery/image",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/mystery/image/:key",
    mountPath: "/api/mystery/image",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/api/auth/accept-invite",
    mountPath: "/api/auth",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions9]
  },
  {
    routePath: "/api/auth/accept-invite",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost7]
  },
  {
    routePath: "/api/auth/change-password",
    mountPath: "/api/auth",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions10]
  },
  {
    routePath: "/api/auth/change-password",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost8]
  },
  {
    routePath: "/api/auth/init",
    mountPath: "/api/auth",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions]
  },
  {
    routePath: "/api/auth/init",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/auth/login",
    mountPath: "/api/auth",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions11]
  },
  {
    routePath: "/api/auth/login",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost9]
  },
  {
    routePath: "/api/auth/logout",
    mountPath: "/api/auth",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions12]
  },
  {
    routePath: "/api/auth/logout",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost10]
  },
  {
    routePath: "/api/auth/me",
    mountPath: "/api/auth",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet4]
  },
  {
    routePath: "/api/auth/me",
    mountPath: "/api/auth",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions13]
  },
  {
    routePath: "/api/auth/seed-superadmin",
    mountPath: "/api/auth",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet5]
  },
  {
    routePath: "/api/auth/seed-superadmin",
    mountPath: "/api/auth",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions14]
  },
  {
    routePath: "/api/auth/seed-superadmin",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost11]
  },
  {
    routePath: "/api/auth/users",
    mountPath: "/api/auth",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet6]
  },
  {
    routePath: "/api/auth/users",
    mountPath: "/api/auth",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions15]
  },
  {
    routePath: "/api/auth/users",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost12]
  },
  {
    routePath: "/api/auth/validate-token",
    mountPath: "/api/auth",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet7]
  },
  {
    routePath: "/api/auth/validate-token",
    mountPath: "/api/auth",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions16]
  },
  {
    routePath: "/api/mystery/admin",
    mountPath: "/api/mystery",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions17]
  },
  {
    routePath: "/api/mystery/admin",
    mountPath: "/api/mystery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost13]
  },
  {
    routePath: "/api/mystery/comment",
    mountPath: "/api/mystery",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions18]
  },
  {
    routePath: "/api/mystery/comment",
    mountPath: "/api/mystery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost14]
  },
  {
    routePath: "/api/mystery/featured",
    mountPath: "/api/mystery",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet8]
  },
  {
    routePath: "/api/mystery/featured",
    mountPath: "/api/mystery",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions19]
  },
  {
    routePath: "/api/mystery/galleries",
    mountPath: "/api/mystery",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet9]
  },
  {
    routePath: "/api/mystery/galleries",
    mountPath: "/api/mystery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost15]
  },
  {
    routePath: "/api/mystery/gallery-manage",
    mountPath: "/api/mystery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost16]
  },
  {
    routePath: "/api/mystery/init",
    mountPath: "/api/mystery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost17]
  },
  {
    routePath: "/api/mystery/photos",
    mountPath: "/api/mystery",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet10]
  },
  {
    routePath: "/api/mystery/publish",
    mountPath: "/api/mystery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost18]
  },
  {
    routePath: "/api/mystery/upload",
    mountPath: "/api/mystery",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions20]
  },
  {
    routePath: "/api/mystery/upload",
    mountPath: "/api/mystery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost19]
  },
  {
    routePath: "/api/mystery/verify",
    mountPath: "/api/mystery",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions21]
  },
  {
    routePath: "/api/mystery/verify",
    mountPath: "/api/mystery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost20]
  },
  {
    routePath: "/api/mystery/vote",
    mountPath: "/api/mystery",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions22]
  },
  {
    routePath: "/api/mystery/vote",
    mountPath: "/api/mystery",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost21]
  },
  {
    routePath: "/api/search",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions23]
  },
  {
    routePath: "/api/search",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost22]
  },
  {
    routePath: "/oauth/auth",
    mountPath: "/oauth",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet11]
  },
  {
    routePath: "/oauth/callback",
    mountPath: "/oauth",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet12]
  },
  {
    routePath: "/api/auth",
    mountPath: "/api/auth",
    method: "",
    middlewares: [onRequest],
    modules: []
  },
  {
    routePath: "/",
    mountPath: "/",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  }
];

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-pcnWMs/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-pcnWMs/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.31173505081260666.mjs.map
