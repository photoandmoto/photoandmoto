# IAM Design — Photo & Moto `/yllapito`

Identity & Access Management design for the custom admin at `/fi/yllapito`.
This is the **agreed design** as of June 2026 — implementation has not yet
started. Use this document as the single source of truth for the build.

**Scope:** This applies ONLY to the custom `/yllapito` admin (mystery photos,
galleries, future admin features). It does NOT touch Decap CMS at `/admin/`,
which stays on GitHub OAuth as today. See § Out of Scope.

---

## 1. What this design accomplishes

Today, `/yllapito` is gated by a single shared password (`UPLOAD_PASSWORD` env
var). Everyone with that password has full access to everything. There's no
audit trail of who did what, no way to revoke access for one person, no way to
grant partial access.

This design replaces that with a proper per-user IAM system:

- **Per-user accounts** with email + password
- **Provisioning by link** — admin generates a link, sends it manually via
  email, user clicks it and sets their own password and security questions
- **Per-function access control** — checkbox matrix per user controls which
  tabs they can see and which endpoints they can call
- **Self-service password change** (knowing current password) and **self-service
  account recovery** via security questions (2 of 3)
- **Admin fallback** for users who forget everything — admin can regenerate
  the provisioning link from the Käyttäjät tab
- **No email infrastructure** — all "emails" are manually sent by the admin
  via Gmail

---

## 2. Out of scope (intentional non-goals)

- **Decap CMS authentication.** Stays on GitHub OAuth. Article editors are
  provisioned by Arto creating a GitHub account for them with their email and
  emailing them the credentials. The `Hallitse artikkeleita` checkbox in the
  IAM matrix only controls whether the *link tab* to `/admin/` is visible in
  `/yllapito` — it does NOT control Decap access itself.
- **Automated email delivery.** No Resend, no Mailgun, no SMTP. The admin
  manually emails provisioning links via their own Gmail.
- **2FA / TOTP.** Future consideration. Not in v1.
- **SSO / OAuth.** The whole point of this design is to avoid GitHub
  provisioning for non-technical editors.
- **Automated forgot-password email.** Recovery is via security questions
  (self-service) with admin fallback.
- **Audit log of content changes** (who edited which mystery photo). Out of
  scope for v1 — could be added separately as a `audit_log` table later.

---

## 3. Locked-in decisions

Every design decision below is **locked**. Do not re-litigate during
implementation without an explicit user discussion.

| Topic | Decision | Rationale |
|---|---|---|
| **Auth scope** | `/yllapito` only — Decap stays as-is | Replacing Decap would discard the migration work just shipped |
| **Roles** | Two roles: `admin`, `editor` | Simpler than 4-role granularity; permission checkboxes give the actual control |
| **Permission model** | Per-function boolean flags per user | Role is a label + checkbox-autofill preset; checkboxes are the truth |
| **Provisioning** | Admin creates user in UI → backend returns one-time link → admin copies and emails manually | No email infrastructure required, admin has personal oversight on every invite |
| **Password storage** | PBKDF2-SHA256, 200,000 iterations, 16-byte salt, stored as base64 in D1 | bcrypt unavailable in Workers; PBKDF2 via Web Crypto is the standard |
| **Password rules** | Min 12 chars, max 128 chars, ≥3 of 4 character types, block top-100 common, block self-data | NIST SP 800-63B 2023 guidance — length over complexity |
| **No rotation** | Passwords don't expire | NIST guidance — forced rotation creates predictable patterns |
| **Self-service password change** | Yes — requires current password + new password | Standard security practice |
| **Account recovery** | Yes — security questions (2 of 3) | Self-service primary path, no email infrastructure |
| **Recovery fallback** | Yes — admin can regenerate provisioning link from Käyttäjät tab | Option 1: belt-and-braces. Roughly 5% of users will need this. |
| **Security questions** | User-written (not pre-canned). 3 questions, must answer 2 to recover. Answers hashed with same PBKDF2 as passwords. | User-written = harder to social-engineer than pre-canned. 2-of-3 forgives genuine forgetting. |
| **Sessions** | 30-day cookie, HttpOnly + Secure + SameSite=Strict, server-side session table | Standard pattern |
| **Rate limiting** | 5 login attempts / 5 recovery attempts per IP per hour | Cloudflare's built-in `RateLimit` binding |
| **Session destruction** | All sessions destroyed on recovery (forced re-login everywhere) | Standard post-recovery hygiene |
| **Audit log retention** | 90 days for `recovery_attempts` table | DEFAULT — confirm during implementation. GDPR-friendly. |
| **Seed super-admin email** | `photoandmoto@gmail.com` | Project email, not personal |
| **Seed bootstrap** | One-time Cloudflare console log of provisioning link | Avoids chicken-and-egg of needing auth to set up auth |
| **Arto's security questions** | Set on first login (one-time prompt) | DEFAULT — confirm during implementation. Cleanest bootstrap. |
| **Migration** | Dual-mode (session OR `UPLOAD_PASSWORD`) during transition window | Safety net while flipping over |
| **No "remember me" toggle** | Always 30 days | Reduces UI surface |
| **GDPR** | User data is staff data (not site visitors); existing tietosuojaseloste covers it | Same legal basis as employment records |

---

## 4. Database schema

All three tables go in the existing `photoandmoto-community` D1 database
(production) and `photoandmoto-community-dev` (staging). Created by
`functions/api/auth/init.js`, idempotent (uses `CREATE TABLE IF NOT EXISTS`).

```sql
-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),

  -- Per-function permission flags
  perm_tarkista INTEGER DEFAULT 0,
  perm_lahetakuva INTEGER DEFAULT 0,
  perm_hallitse_galleriaa INTEGER DEFAULT 0,
  perm_hallitse_artikkeleita INTEGER DEFAULT 0,  -- cosmetic only; gates the tab link in /yllapito
  perm_admin_iam INTEGER DEFAULT 0,              -- access to the Käyttäjät tab + user management endpoints

  -- Auth state
  password_hash TEXT,                            -- NULL until invite accepted
  password_salt TEXT,
  password_set_at TEXT,

  -- Security questions (hashed answers)
  security_q1 TEXT,
  security_a1_hash TEXT,
  security_a1_salt TEXT,
  security_q2 TEXT,
  security_a2_hash TEXT,
  security_a2_salt TEXT,
  security_q3 TEXT,
  security_a3_hash TEXT,
  security_a3_salt TEXT,

  -- Audit
  created_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER,
  last_login_at TEXT,
  last_recovery_at TEXT,
  is_active INTEGER DEFAULT 1,

  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- One-time provisioning / regeneration tokens
CREATE TABLE IF NOT EXISTS provisioning_tokens (
  token_hash TEXT PRIMARY KEY,                   -- SHA-256 of the raw token
  user_id INTEGER NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('initial_provision', 'admin_reset')),
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER,                            -- which admin created this token
  used_at TEXT,                                  -- NULL = unused
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tokens_user ON provisioning_tokens(user_id);

-- Active sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  user_agent TEXT,
  ip TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Recovery attempts (rate limiting + audit)
CREATE TABLE IF NOT EXISTS recovery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,                               -- NULL if email not found (prevents enumeration)
  email_attempted TEXT,
  ip TEXT,
  succeeded INTEGER DEFAULT 0,
  attempted_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_recovery_attempts_ip ON recovery_attempts(ip, attempted_at);
CREATE INDEX IF NOT EXISTS idx_recovery_attempts_email ON recovery_attempts(email_attempted, attempted_at);
```

### Cleanup jobs

Two periodic cleanups (Cloudflare Cron Triggers, daily):

- Delete `sessions` rows where `expires_at < datetime('now')`
- Delete `recovery_attempts` rows older than 90 days
- Delete `provisioning_tokens` rows where `expires_at < datetime('now')` AND `used_at IS NOT NULL` (keep unused expired ones for audit)

---

## 5. Endpoints

All under `functions/api/auth/`. Authentication column shows what's required.

| Method + Path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/init` | none, idempotent | DB schema bootstrap (called by `requireAuth` on first hit) |
| `POST /api/auth/seed-superadmin` | env-var check (one-time) | Creates the first super-admin from `SUPER_ADMIN_EMAIL` env. Logs the provisioning link to Workers console. Self-destructs after first successful run (refuses if any user exists). |
| `POST /api/auth/users` | session + `perm_admin_iam` | Creates user row + provisioning token. Body: `{ first_name, last_name, email, role, permissions: {...} }`. Returns: `{ user, provisioning_link, expires_at }`. Raw token shown ONCE. |
| `GET /api/auth/users` | session + `perm_admin_iam` | Lists all users for Käyttäjät tab. Excludes hashes/tokens. |
| `PATCH /api/auth/users/:id` | session + `perm_admin_iam` | Update first_name, last_name, role, permissions, is_active. Cannot change email (would require re-provisioning). |
| `POST /api/auth/users/:id/regenerate-link` | session + `perm_admin_iam` | Invalidates any existing unused token for this user, generates a new one. Returns: `{ provisioning_link, expires_at }`. Use case: forgot-everything fallback. |
| `POST /api/auth/users/:id/deactivate` | session + `perm_admin_iam` | Sets `is_active = 0`, destroys all sessions for that user. |
| `GET /api/auth/validate-token?token=...` | none | Editor's invite page calls this on load. Returns 200 with `{ first_name, email }` if valid; 410 if expired/used. |
| `POST /api/auth/accept-invite` | none | Body: `{ token, password, security_questions: [{q,a},{q,a},{q,a}] }`. Validates token, hashes password+answers, marks token used, creates session, returns Set-Cookie. |
| `POST /api/auth/login` | none | Body: `{ email, password }`. Rate-limited. On success: creates session, sets cookie. |
| `POST /api/auth/logout` | session | Destroys current session row, clears cookie. |
| `GET /api/auth/me` | session | Returns `{ id, first_name, last_name, email, role, permissions: {...} }` for the current user. Used by frontend for tab visibility. |
| `POST /api/auth/change-password` | session | Body: `{ current_password, new_password }`. Verifies current, hashes new, keeps sessions alive. |
| `POST /api/auth/recovery/start` | none | Body: `{ email }`. Rate-limited. Always returns 200 (don't leak whether email exists). If email exists, returns the 3 security questions. |
| `POST /api/auth/recovery/verify` | none | Body: `{ email, answers: [{q_index, answer}, ...] }`. Verifies ≥2 of 3 match. On success: returns one-time token. Rate-limited. |
| `POST /api/auth/recovery/complete` | none | Body: `{ recovery_token, new_password }`. Validates token, sets new password, **destroys all sessions for user**, creates a new session, sets cookie. |
| `GET /api/auth/audit/recoveries` | session + `perm_admin_iam` | Lists recent recovery attempts (succeeded + failed) for admin oversight. |

### Shared auth lib

New file `functions/_lib/auth.js` (or similar — name TBD based on Pages Functions conventions):

```javascript
export async function requireAuth(request, env, requiredPerm = null) { ... }
export async function hashPassword(password) { ... }
export async function verifyPassword(password, hash, salt) { ... }
export async function generateToken() { ... }
export async function hashToken(rawToken) { ... }
export function setSessionCookie(sessionId) { ... }
export async function destroyAllSessionsForUser(env, userId) { ... }
```

---

## 6. User flows

### 6.1 Admin creates a new user

```
1. Admin opens /yllapito → Käyttäjät tab
2. Clicks "+ Luo uusi käyttäjä"
3. Modal opens. Admin fills:
   - First name, last name, email
   - Role (admin/editor) → checkboxes auto-fill (admin = all 1, editor = none)
   - Adjusts checkboxes per user
4. Clicks "Luo käyttäjä ja generoi linkki"
5. POST /api/auth/users
6. Backend:
   - Validates input (email unique, email valid, names not empty)
   - Inserts user row with password_hash = NULL
   - Generates random 32-byte token → hashes for storage
   - Inserts provisioning_tokens row, purpose='initial_provision', expires 48h
   - Returns: { user, provisioning_link, expires_at }
7. Modal updates to show the link:
   ┌─────────────────────────────────────────────┐
   │ ✅ Käyttäjä Teppo Terävä luotu              │
   │                                             │
   │ Lähetä tämä linkki Tepolle (vanhenee 48h):  │
   │                                             │
   │ https://www.photoandmoto.fi/fi/aseta-       │
   │   salasana?token=abc123...                  │
   │                                             │
   │ [📋 Kopioi linkki]                          │
   │                                             │
   │ ⚠️ Tämä linkki näytetään vain kerran.      │
   └─────────────────────────────────────────────┘
8. Admin copies link, pastes into Gmail, sends to teppo@teppo.com
```

### 6.2 Editor accepts invite

```
1. Editor clicks the link from Gmail
   → /fi/aseta-salasana?token=abc123...
2. Page calls GET /api/auth/validate-token?token=abc123...
   - If 410: shows "Linkki on vanhentunut tai käytetty"
   - If 200: shows greeting "Tervetuloa, Teppo!"
3. Editor sees the form:
   - Password (with live validation: 12+ chars, 3 char types, etc.)
   - Confirm password
   - Security questions: 3 question/answer pairs
4. Editor submits → POST /api/auth/accept-invite { token, password, security_questions }
5. Backend:
   - Verifies token (hashed lookup), not used, not expired
   - Hashes password + each answer (PBKDF2, per-answer salt)
   - UPDATE users SET ...
   - UPDATE provisioning_tokens SET used_at = datetime('now')
   - Creates session row
   - Returns: 200 + Set-Cookie
6. Frontend redirects to /fi/yllapito
7. /yllapito loads, calls GET /api/auth/me, hides tabs the user can't access
```

### 6.3 Returning user logs in

```
1. Editor visits /fi/yllapito (no session cookie OR expired)
2. Sees login form: email + password
3. Submits → POST /api/auth/login { email, password }
4. Backend:
   - Check rate limit (5 attempts / hour per IP+email)
   - Look up user by email
   - verifyPassword(password, user.password_hash, user.password_salt)
   - If valid + is_active: create session, Set-Cookie
   - If invalid: 401, increment rate limit
5. Frontend reloads with tabs visible per permissions
```

### 6.4 Logged-in user changes password

```
1. User clicks "Vaihda salasana" in account dropdown
2. Modal: current password, new password (with live validation), confirm
3. Submit → POST /api/auth/change-password { current_password, new_password }
4. Backend:
   - Verify current password
   - Hash new password
   - UPDATE users (password_hash, password_salt, password_set_at)
   - Sessions remain alive (this is a deliberate password change, not a recovery)
5. Show success toast
```

### 6.5 User recovers a forgotten password

```
1. User clicks "Unohditko salasanan?" on login page
2. /fi/palauta-salasana page asks for email
3. Submit → POST /api/auth/recovery/start { email }
4. Backend:
   - Check rate limit (5 per hour per IP+email)
   - Look up user. ALWAYS return same response shape regardless of existence
     (don't leak account enumeration)
   - If exists: returns { questions: [q1, q2, q3] }
   - If not: returns { questions: [<random plausible decoys>] } — user fills
     them, all fail, sees the same "wrong answers" message
5. User answers 3 questions (can leave one blank) → POST /api/auth/recovery/verify
6. Backend:
   - Verify ≥2 answers match (PBKDF2 hash compare, after lowercase+trim)
   - Log to recovery_attempts (succeeded or not)
   - If success: generate single-use recovery token, return it
   - If fail: 401, "Vastaukset eivät täsmää"
7. User sees new-password form → POST /api/auth/recovery/complete { recovery_token, new_password }
8. Backend:
   - Validate recovery token
   - Hash new password, UPDATE users
   - DELETE FROM sessions WHERE user_id = ?  ← destroys ALL existing sessions
   - Create one new session, Set-Cookie
   - UPDATE users SET last_recovery_at = datetime('now')
9. Frontend redirects to /fi/yllapito (logged in)
10. Admin sees the recovery in audit log on next Käyttäjät view
```

### 6.6 Admin fallback recovery (user forgot everything)

```
1. User emails photoandmoto@gmail.com: "I forgot my password AND my
   security question answers. Can you help?"
2. Admin opens /yllapito → Käyttäjät tab
3. Finds the user row, clicks "🔄 Luo uusi linkki"
4. Modal asks: "Luodaanko uusi provisioning-linkki tälle käyttäjälle?
   Vanha salasana ja palautuskysymykset poistetaan."
5. Confirms → POST /api/auth/users/:id/regenerate-link
6. Backend:
   - Invalidate any existing unused tokens for this user
   - Generate new token, purpose='admin_reset'
   - UPDATE users SET password_hash=NULL, all security_a*_hash=NULL,
     all security_q*=NULL
   - Destroy all sessions for this user
7. Modal shows the new link (same UX as initial provisioning)
8. Admin copies, emails the user
9. User clicks link → goes through accept-invite flow again
   (sets new password + new security questions)
```

### 6.7 Admin deactivates a user

```
1. Admin opens Käyttäjät → finds user → clicks "Poista käytöstä"
2. Confirmation: "Tämä lopettaa käyttäjän pääsyn välittömästi"
3. POST /api/auth/users/:id/deactivate
4. Backend: UPDATE users SET is_active=0; DELETE FROM sessions WHERE user_id=?
5. User is logged out immediately on next request
```

---

## 7. Frontend changes

### 7.1 New pages

- `src/pages/fi/aseta-salasana.astro` — invite acceptance page. Reads `?token=`
  from URL, validates, shows the password + security questions form.
- `src/pages/fi/palauta-salasana.astro` — recovery flow page (multi-step:
  email → questions → new password).

### 7.2 Changed pages

- `src/pages/fi/yllapito.astro`:
  - Login form: from single password field to email + password
  - Add "Unohditko salasanan?" link below the form
  - Add "Vaihda salasana" item in the account/logout dropdown
  - New tab: **Käyttäjät** (visible only if `perm_admin_iam`)
  - Existing tabs (Tarkista, Lähetä kuva, Hallitse galleriaa, Hallitse
    artikkeleita) hidden/shown based on user's permissions
  - All `/api/mystery/*` calls already send credentials via cookie — no
    request body changes needed once dual-mode fallback is removed

### 7.3 Käyttäjät tab UI

Table component matching the spreadsheet model:

```
Käyttäjät                                  [ + Luo uusi käyttäjä ]

┌─────────┬─────────┬─────────────────┬────────┬───┬───┬───┬───┬─────┬──────────┐
│ Etunimi │ Sukunimi│ Email           │ Rooli  │ T │ L │ H │ A │ IAM │ Toiminnot│
├─────────┼─────────┼─────────────────┼────────┼───┼───┼───┼───┼─────┼──────────┤
│ Arto    │ Vilk    │ photoandmoto@.. │ admin  │ ☑ │ ☑ │ ☑ │ ☑ │  ☑  │ (sinä)   │
│ Teppo   │ Terävä  │ teppo@teppo.com │ editor │ ☑ │ ☑ │ ☐ │ ☐ │  ☐  │ ⋯ valikko│
│ Niilo   │ Nippo   │ niilo@nippo.com │ editor │ ☑ │ ☑ │ ☑ │ ☐ │  ☐  │ ⋯ valikko│
└─────────┴─────────┴─────────────────┴────────┴───┴───┴───┴───┴─────┴──────────┘

T = Tarkista, L = Lähetä kuva, H = Hallitse galleriaa,
A = Hallitse artikkeleita (tabin näkyvyys, ei oikeasti suojaa Decapia),
IAM = Admin-oikeudet käyttäjähallintaan

(All cells editable inline except "you" row; checkboxes save on change.)

⋯ valikko per user row:
  - Muokkaa nimeä
  - Luo uusi provisioning-linkki (forgot-password fallback)
  - Poista käytöstä / Aktivoi
  - Näytä viimeisin palautus-yritys
```

Modal: **+ Luo uusi käyttäjä** (see § 6.1).

---

## 8. Migration plan

### Phase A — Build everything in parallel to existing system

Build all schema, endpoints, UI behind a feature flag (or just on a branch).
`UPLOAD_PASSWORD` stays the gate for all `/api/mystery/*` endpoints in main
during this phase. Test on staging.

### Phase B — Schema migration on production D1

Run `init.js` against production D1. Tables exist but empty. No behavior
change yet.

### Phase C — Dual-mode cutover

Update all `/api/mystery/*` endpoints to a dual-mode check:

```javascript
// Try session first
const auth = await tryRequireAuth(request, env, 'lahetakuva');
if (auth.user) {
  // proceed with auth.user
} else {
  // Fallback: legacy UPLOAD_PASSWORD check
  if (body.password === env.UPLOAD_PASSWORD) {
    // proceed (no user attribution)
  } else {
    return new Response('Unauthorized', { status: 401 });
  }
}
```

Deploy. Both auth paths work. Nothing breaks.

### Phase D — Seed super-admin

1. Cloudflare console → Pages project → Settings → Environment variables
2. Add `SUPER_ADMIN_EMAIL = photoandmoto@gmail.com`
3. Add `SUPER_ADMIN_FIRST_NAME = Arto`
4. Add `SUPER_ADMIN_LAST_NAME = Vilkman`
5. Redeploy
6. Hit `POST /api/auth/seed-superadmin` once (via curl or browser dev tools)
7. Endpoint logs the provisioning link to the Cloudflare Workers console
8. Arto reads the log, clicks the link, sets password + security questions
9. Arto is now logged in as super-admin

### Phase E — Provision other users

Arto opens Käyttäjät tab, creates each user, copies link, emails them. They
each accept their invite.

### Phase F — Remove the fallback

Once all real users are migrated:

1. Remove the `UPLOAD_PASSWORD` fallback branch from all `/api/mystery/*` endpoints
2. Delete `UPLOAD_PASSWORD` from Cloudflare environment variables
3. Deploy
4. Verify everything still works

### Phase G — Disable the seed endpoint

Either remove the route file entirely OR have the endpoint check the user
count and refuse permanently. The function self-destruct on first successful
run also makes this less critical.

---

## 9. Security considerations

### What this design protects against

| Threat | Mitigation |
|---|---|
| Shared-password leak (current state) | Per-user passwords, can be rotated individually |
| Stolen D1 database | All passwords and security answers stored as PBKDF2 hashes; tokens stored as SHA-256 hashes |
| Session hijacking via XSS | Cookie is `HttpOnly`, JS can't read it |
| Session hijacking via insecure connection | Cookie is `Secure`, only sent over HTTPS |
| CSRF | Cookie is `SameSite=Strict` |
| Brute force on login | Rate limit: 5 attempts/hour per IP+email |
| Brute force on recovery | Rate limit: 5 attempts/hour per IP+email |
| Account enumeration via login error | "Väärä sähköposti tai salasana" (generic) — never distinguish |
| Account enumeration via recovery | Always show questions form, even if email doesn't exist |
| Token replay | Tokens single-use (`used_at` set) and time-bounded (48h) |
| Token brute-force | 256-bit random tokens, infeasible to guess |
| Compromised account via security questions | User-written questions (harder to guess than canned), 2-of-3 required, rate-limited, audit-logged |
| Insider abuse (admin demotes self) | UI blocks self-demotion of `perm_admin_iam`; backend also blocks |
| Last-admin lockout | Backend prevents deactivating the only active admin |
| Compromised admin account | Per-user revocation, audit log of recoveries, no shared password |

### What this design does NOT protect against

- **Phishing.** If a user gives their password to a phishing site, this design
  has no defense. 2FA in v2 would help here.
- **Cloudflare account compromise.** If an attacker has Cloudflare access,
  they can read env vars, modify D1 directly, and impersonate anyone. This is
  outside our threat model — Cloudflare is the trust anchor.
- **GitHub App key leak.** Separate concern (publish pipeline uses a GitHub
  App). Doesn't intersect with this IAM.
- **Server-side compromise of running Worker.** Out of scope.

### Cookie / CSRF specifics

- Cookie name: `pm_session`
- Cookie attributes: `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`
- Session ID: 64 hex chars (256 bits of entropy)
- Sessions table is the source of truth — cookie alone proves nothing without
  a matching DB row that's not expired and whose user is active

### Rate limit specifics

Implemented using Cloudflare's `RateLimit` binding (preferred over D1 counters
for performance). Bindings:
- `LOGIN_LIMIT` — 5 requests / 60s per `${ip}:${email}` key
- `RECOVERY_LIMIT` — 5 requests / 3600s per `${ip}:${email}` key

Backed up by a slower D1-based check on `recovery_attempts` (in case Cloudflare
rate limit is misconfigured).

---

## 10. Implementation phases

Honest scope estimate. Phase numbers are sessions, not days.

| Phase | What | Effort |
|---|---|---|
| **1** | DB schema (init.js for auth tables), shared auth lib (hashPassword, verifyPassword, requireAuth, token helpers), seed-superadmin endpoint | ~1 session |
| **2** | All `/api/auth/*` endpoints (CRUD users, login, logout, me, change-password, accept-invite, validate-token, recovery flow). Unit tests for the auth lib. | ~1 session |
| **3** | Dual-mode cutover on all `/api/mystery/*` endpoints. Seed Arto's account. Verify everything still works. | ~half session |
| **4** | New pages: `aseta-salasana.astro`, `palauta-salasana.astro`. Login form rework in `yllapito.astro`. Tab-visibility logic. | ~half session |
| **5** | Käyttäjät admin tab UI + role-based tab visibility + + Luo uusi käyttäjä modal + ⋯ menu actions. | ~half session |
| **6** | Provision real users. Remove `UPLOAD_PASSWORD` fallback. Update docs (README, DEPLOYMENT, JULKAISIJAN_OHJEET). Smoke test. | ~half session |

**Total: ~3 sessions.** Skipping the Käyttäjät admin tab UI and doing user
management via D1 console would cut a session, but isn't recommended (admin
would have no way to provision new users without DB access).

---

## 11. Open items — confirm at start of implementation session

These are defaults, not locked decisions. Quick to revisit:

1. **Audit log retention** — defaulted to 90 days for `recovery_attempts`.
   Could be 30, 90, 180, or "forever". GDPR-friendly default is 90.
2. **Arto's initial security questions** — defaulted to "prompt on first
   login" after accepting the seed invite. Alternative: set them via the
   accept-invite form itself (same as everyone else). Cleanest UX = same form
   for everyone.
3. **Email field editability** — defaulted to "not editable after creation"
   (would require re-provisioning). Could allow if useful.
4. **First-name display in /yllapito header** — could show "Tervetuloa,
   Teppo" once logged in. Nice-to-have.
5. **Tab visibility for `Hallitse artikkeleita`** — defaulted to "visible if
   `perm_hallitse_artikkeleita = 1`". Note this only controls visibility of
   the LINK to /admin/. Decap itself is independently gated by GitHub OAuth.
6. **Cloudflare Cron Trigger setup** — needs configuring in Pages project
   settings for the daily cleanups.

---

## 12. Documentation impact (when shipped)

Files to update when this work lands:

- **`README.md`** — update the "Editing content" section to describe per-user
  login instead of shared password
- **`DEPLOYMENT.md`** — add a new section on the auth system (env vars,
  bootstrap, rate limit bindings); update the `UPLOAD_PASSWORD` mention
- **`JULKAISIJAN_OHJEET.md`** — rewrite the "Kirjautuminen" section: email
  + password instead of shared password; add sections on password change,
  recovery via security questions, and what to do if locked out
- **This file (`IAM_DESIGN.md`)** — mark as "shipped" at the top once
  complete; move to an "archived" status like DECAP-MIGRATION.md

---

## 13. Future considerations (v2)

Explicitly out of scope for v1 but worth tracking:

- **2FA / TOTP** via authenticator apps (Google Authenticator, 1Password, etc.)
- **Audit log of content changes** — who edited which mystery photo, when
- **Bulk user import** — CSV upload for migrating from another system
- **Email notifications** — actually send emails for invites instead of
  copy-paste links (would require Resend/Mailgun setup)
- **Magic-link login** — passwordless option as alternative to password
- **OAuth providers** — Google login, GitHub login as options alongside
  email/password
- **Session management UI** — let users see and revoke their own active
  sessions (e.g., "log out of all other devices")

---

*Document version: 1.0 — June 2026. Status: agreed design, implementation
pending. Last updated: pre-implementation review.*
