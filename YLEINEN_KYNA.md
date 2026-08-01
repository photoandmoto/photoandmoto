# Avustajat & Toimitus — Contributor + Editorial System

**Photo & Moto — Design & State v3.1**
**Status: Phase 1 (article submission), Phase 2 (AI pikauutiset), and Phase 3 (Hyväksynnät) complete on staging (`dev`). Phase 3 pending final production test. All phases pending promotion to production (`main`).**

> Historical note: this feature was originally named **"Yleinen Kynä"**. It is now
> **"Avustajat"** (contributors) and sits under a new **"Toimituskeskus"** hub. The
> filename `YLEINEN_KYNA.md` and the route `/fi/yleinen-kyna` are kept for
> continuity.

---

## Purpose

Let community members — photographers, racers, fans — contribute to
photoandmoto.fi through structured Finnish-language forms, without CMS access.
Two content streams:

1. **Kirjoita artikkeli** — a full article (Phase 1).
2. **Luo pikauutinen** — a short AI-assisted news flash generated from keywords (Phase 2).

All submissions are drafts that go through editorial review before publishing.

---

## Key Changes from v2.0

- **"Yleinen Kynä" page → "Avustajat"** (`/fi/yleinen-kyna`).
- **"Ylläpito" → "Toimitus"** (`/fi/yllapito`).
- **New "Toimituskeskus" landing page** (`/fi/toimitus`) — the single entry point
  for both editorial staff and contributors.
- **Muuta dropdown** now shows **"Toimituskeskus"** only (not Avustajat or
  Toimitus directly).
- **Card-based navigation** replaces tabs on both the Avustajat and Toimitus pages.
- **"Pyydä käyttöoikeutta"** access-request flow on Toimituskeskus, with
  email verification (D1 `access_requests` table).
- **Auto-provisioning email** sent to a new user when their account is created.
- **New IAM role `avustaja`** (alongside `admin`, `editor`).
- **New permission `perm_nahta_gemini_avain`** (gates the Gemini-avain card).
- **All email links are environment-aware** (staging vs production).
- **Idle auto-logout (30 min)** on all gated pages, with a 5-minute warning.
- **Pikauutiset page**: collapsible cards, two-column desktop layout, first-sentence
  preview, all collapsed by default.
- **Gemini prompt hardened**: anti-hallucination (no invented incidents),
  negative events verbatim, Finnish grammar guidance, category-driven tone.
- **12 categories** in all dropdowns, matching the Sveltia `categories` collection.
- **Avustajan Ohjekirja** public help page (`/fi/avustajan-ohjekirja`).
- **Julkaisijan Ohjekirja** card inside Toimitus.
- **Photo storage** (corrected): contributor article images **and** pikauutiset
  photos are committed to **`public/images/`** in the repo (not R2).

---

## Entry Points & Navigation

```
Main nav (FI): Etusivu | Pikauutiset | Galleria | Aikakone | Muuta ▾ | Yhteystiedot
Muuta ▾ : … | Tunnista kuva | Toimituskeskus
EN nav  : unchanged (no Toimituskeskus / Avustajat / Toimitus)
```

- **`/fi/toimitus`** — Toimituskeskus. Login + access-request gate; after login,
  permission-aware cards link to Toimitus and/or Avustajat.
- **`/fi/yleinen-kyna`** — Avustajat (contributor tools).
- **`/fi/yllapito`** — Toimitus (editorial/admin tools).
- **`/fi/pikauutiset`** — public pikauutiset feed.
- **`/fi/avustajan-ohjekirja`** — public contributor guide.
- **`/fi/app/`** — PWA (Avustajan sovellus) — standalone Android home-screen
  app. Splash → login → Pikauutinen + Kuva tabs. Shares the same IAM
  session cookie and `laheta_artikkeli` gate as Avustajat.

---

## User Roles & Permissions

| Role | Typical permissions |
|---|---|
| `admin` | All editorial permissions + `admin_iam` (user management) |
| `editor` | `tarkista`, `lahetakuva`, `hallitse_artikkeleita` (defaults; adjustable) |
| `avustaja` | `laheta_artikkeli` only (contributor) |

**Permission flags** (D1 `users.perm_*`, surfaced as `permissions.*` by `requireAuth`):

| Flag | Grants |
|---|---|
| `tarkista` | Mystery-photo review |
| `lahetakuva` | Upload mystery photos |
| `hallitse_galleriaa` | Gallery management |
| `hallitse_artikkeleita` | Sveltia CMS + Julkaise |
| `admin_iam` | User management (Käyttäjät) |
| `laheta_artikkeli` | Avustajat submission forms |
| `nahta_gemini_avain` | See the Gemini-avain card (off by default for everyone, incl. admin) |

**Role default ticks on user creation** (`KT_ROLE_DEFAULTS` in `yllapito.astro`):
- Admin → all except `nahta_gemini_avain`
- Editor → `tarkista`, `lahetakuva`, `hallitse_artikkeleita`
- Avustaja → `laheta_artikkeli` only

---

## Page-by-Page

### Toimituskeskus — `/fi/toimitus`
- **Unauthenticated:** two cards — **Kirjaudu sisään** (login) and **Pyydä
  käyttöoikeutta** (access request form).
- **Authenticated:** permission-aware cards (no auto-redirect):
  - **Toimitus** card → `/fi/yllapito` — shown if the user has *any* of
    `tarkista / lahetakuva / hallitse_galleriaa / hallitse_artikkeleita / admin_iam`.
  - **Avustajat** card → `/fi/yleinen-kyna` — shown if `laheta_artikkeli`.
  - Neither → "Sinulla ei ole käyttöoikeutta. Ota yhteyttä toimitukseen."
- Password field has an eye toggle + Caps Lock warning; credentials cleared after login.

### Avustajat — `/fi/yleinen-kyna`
- Login gate (login card only — the access-request card lives on Toimituskeskus).
- After login (with `laheta_artikkeli`): card grid → **Kirjoita artikkeli** /
  **Luo pikauutinen** / **Avustajan Ohjekirja**. "← Avustajat" returns to the grid.
- **Kirjoita artikkeli** form → `POST /api/submit-article`.
- **Luo pikauutinen** form → `POST /api/generate-article` (Gemini).
- "Tyhjennä" clears a form and stays on it; only the back link returns to the grid.
- The pikauutinen review step ("Tarkista pikauutinen") carries a **Julkaise
  nimettömänä** checkbox — see *Byline vs. identity* below. The mobile app
  (`/fi/app`) has the same control; the two must stay in sync.

### Toimitus — `/fi/yllapito`
- Login gate (`admin-panel`), then a permission-aware **card grid** ordered to follow
  the editorial workflow — bring material in, check it, manage the libraries,
  approve, look up history, deploy, then admin:
  Lähetä kuva · Tarkista · Hallitse galleriaa · Hallitse artikkeleita (Sveltia ↗) ·
  Hyväksynnät · **Julkaisujono** (↗ own page) · Julkaise · Käyttäjät ·
  **Julkaisijan Ohjekirja** (last). "← Toimitus" returns to the grid;
  "← Toimituskeskus" link at the top.
- Each card opens its section in place. Cards appear only if the user has the
  matching permission (the Ohjekirja card is always shown).
- **Julkaise** section is a 2×2 card grid: Julkaise esikatseluun · Esikatsele ·
  Julkaise tuotantoon · **Gemini-avain** (gated by `nahta_gemini_avain`).
- **Käyttäjät** modal: role dropdown (Editor/Admin/Avustaja), permission checkboxes
  (incl. "Avustajat" and "Näytä Gemini-avain"), role-based default ticks on create.

### Julkaisujono — `/fi/julkaisujono`
- Read-only history of **every submission**, any status, newest first. Its own page
  rather than a section of `/fi/yllapito` (that file is already ~6.8k lines).
- Exists because **Hyväksynnät only lists `status = 'odottaa'`** — the moment an item
  is approved or rejected it disappears from every screen. The D1 row survived but
  nothing surfaced it, so "who sent us this published article?" could only be
  answered by querying D1 by hand. That is the question a copyright claim raises.
- Shows submitter name + email, date, type, category, `github_slug`, and the byline
  it was published under. Search matches title / name / email / slug, so a live
  article can be traced back to the person who submitted it. Status + type filters.
- **Read-only by design.** Approving and rejecting stay in Hyväksynnät so exactly one
  screen mutates state.
- Submissions published under the house byline by a *named* submitter are flagged
  "Julkaistu nimettömänä — älä julkaise lähettäjän nimeä". Toimitus can see the real
  name here, so the contributor's choice needs to be visible, not inferred.
- Gated by `hallitse_artikkeleita` (enforced by `/api/submissions`, not the page).
- Only covers content that came through **Yleinen Kynä / the mobile app**. Anything
  written directly in Sveltia never touches the submit API, so it has no row — that
  is expected, not a gap: in-house content is authored by Toimitus itself.
- Styles use `<style is:global>`: rows are built client-side via `innerHTML`, so they
  never receive Astro's scoping attribute and scoped rules would not match them.

### Pikauutiset — `/fi/pikauutiset`
- Public, FI only. Latest 10 published items, newest first (older archived in git).
- **Collapsible cards**, all **collapsed by default** (state in-memory, never persisted).
  Collapsed shows the square thumbnail + title + date + author + **first sentence**;
  expanding reveals the full body. Two columns on desktop, one on mobile.
- Subtitle: "Lyhyet uutiset moottoriurheilun maailmasta."

### Avustajan Ohjekirja — `/fi/avustajan-ohjekirja`
- Public contributor guide (login, article form, pikauutinen form, image rules,
  editorial process, contact). "← Takaisin" button (see Known issues).

---

## Access Request Flow — "Pyydä käyttöoikeutta"

Two-step, double-opt-in, so the editor inbox isn't notified until the requester
confirms their email.

1. **Request** (`POST /api/request-access`): validates name/email/reason,
   generates a 32-byte token, stores it in D1 `access_requests`
   (`verified = 0`, `expires_at = now + 24h`), and emails the **requester** a
   verification link. Same-origin check + 3/IP/hour rate limit. **No editor email yet.**
2. **Verify** (`GET /api/verify-access-request?token=…`): on a valid, unexpired,
   unverified token → marks `verified = 1` and emails the **editor**
   (`photoandmoto@gmail.com`) with the details + a link to create the account
   as an Avustaja. Idempotent (a second click says "already verified").
3. **Landing page** `/fi/vahvista-pyynto?token=…` calls the verify endpoint and
   shows confirmed / expired-or-invalid.

The editor then creates the account in Toimitus → Käyttäjät → role **Avustaja**,
which triggers the auto-provisioning email.

---

## Account Provisioning

- Creating a user (`POST /api/auth/users`) generates a one-time provisioning token
  (TTL **24 hours**, `PROVISIONING_TOKEN_TTL_SECONDS = 86400`) and a link to
  `/fi/aseta-salasana?token=…`.
- An **activation email is sent automatically** to the new user (subject
  "Tervetuloa Photo & Moto — aktivoi tilisi"). Non-fatal: if Resend is
  unconfigured or fails, the link is still returned in the API response for the
  admin to copy manually.
- On `/fi/aseta-salasana`, the user sets a password + 3 recovery questions.
  After activation the redirect is role-aware: contributor-only accounts
  (`laheta_artikkeli`, no editor/admin perms) → `/fi/toimitus`; editors/admins →
  `/fi/yllapito`.

---

## Content Model

### Articles — `src/content/articles/fi/<slug>.md`
Written by `submit-article.js` (and by editors in Sveltia). Frontmatter conforms
to the Zod schema in `src/content.config.ts`: `title`, `subtitle?`, `author`
(from IAM session), `date`, `category`, `tags`, `featured_image`,
`featured_image_focus?`, `card_image?`, `card_image_focus?`, `show_hero`,
`image_caption?`, `language`, `draft` (always `true` on submit),
`seo_description?` (editor-only), `sources?`. Body is the markdown content area.

### Pikauutiset — `src/content/pikauutiset/<date>-<slug>.md`
Written by `generate-article.js`. Lean, FI-only collection. Frontmatter: `title`
(Gemini), `date` (event date), `author` (**byline** — see below), `category`,
`photo?`, `draft` (always `true`), `source` (always `"ai_generated"`). The 2–3
sentence text is the **markdown body** (content area), same convention as articles —
not a frontmatter field. Sveltia: `source` hidden; `author` is a **visible required
field** defaulting to `Photo & Moto`, so Toimitus can see and correct the byline
during review.

`author` holds the **byline only, never the submitter's identity** — this repo is
public, so a contributor's name must not be written into a content file unless they
chose to be named. Identity lives in D1 (`submissions.author_id` / `author_name` /
`author_email`), behind login.

The schema coerces a missing, null or empty `author` to `Photo & Moto`
(`z.preprocess` in `src/content.config.ts`). This is a **build-safety net, not a
convenience**: content collections are validated for drafts too, so a single
submission with no author previously failed `astro build` and blocked production
deploys for everyone — including drafts Toimitus had not reviewed yet. Both write
paths now always set a real value; the preprocess only ensures a byline problem can
never take the site's deploy pipeline down again.

### Categories — 12 (from `src/content/categories/`)
Enduro · Haastattelu (Interview) · Henkilökuva (Profile) · Historiallinen
(Historical) · Ice speedway · Maarata (Long Track) · Motocross · MXGP · Scramble ·
Speedway · Tekninen (Technical) · Trail. The Avustajat dropdowns and the backend
`ALLOWED_CATEGORIES` / `CATEGORY_LABELS` all match this list (stored `name`,
displayed Finnish `label`).

---

## Photo Storage

- **Contributor article images** (Phase 1) and **pikauutiset photos** (Phase 2)
  are both committed to **`public/images/`** in the GitHub repo, in the same App
  commit as the `.md`. Filenames are sanitized (ASCII, no colons, spaces → hyphens),
  10 MB max, JPG/PNG/WebP.
- This is the corrected behavior — R2 is **not** used for these uploads. (The
  earlier R2 serving function was removed because Sveltia's media library resolves
  images from the repo.) See `INFRASTRUCTURE.md` for the planned future R2 move.

---

## Emails (Resend, env-aware)

All links use `baseUrl = (env.CF_PAGES_BRANCH === 'main') ? 'https://www.photoandmoto.fi'
: 'https://photoandmoto-staging.pages.dev'`.

| Trigger | To | Subject |
|---|---|---|
| Access request (step 1) | requester | Vahvista käyttöoikeuspyyntösi — Photo & Moto |
| Request verified (step 2) | editor | Uusi Avustaja-käyttöoikeuspyyntö — [name] |
| New article submitted | editor | Uusi artikkeli odottaa tarkistusta — [title] |
| New pikauutinen submitted | editor | Uusi pikauutinen odottaa tarkistusta — [title] |
| Submission rejected (Phase 3) | author | Lähettämäsi [type] ei mennyt läpi — Photo & Moto |
| User created | new user | Tervetuloa Photo & Moto — aktivoi tilisi |

`RESEND_API_KEY` must be set on each environment; sends are non-fatal where the
underlying record is already saved.

---

## AI / Gemini (pikauutiset)

- Model `gemini-2.5-flash`, `responseMimeType: 'application/json'` (JSON mode
  on — required for structured `{title, body}` output), `maxOutputTokens: 8192`,
  `temperature: 0.6`. `parseGeminiJson()` also strips any fence-wrapping as a
  safety net. Strict `{title, body}` parse; non-empty validation;
  title ≤80, body ≤450–500 chars (`clamp()` at sentence boundary).
- **`/api/search`** uses the same `gemini-2.5-flash` model without JSON mode
  (`maxOutputTokens: 1500`) — free-form prose response, no structured output.
- Rate limit: **50 generations per IP per hour** (in-memory, Worker-level).
  Quota exceeded → 429 with Finnish message.
- Hardened prompt (`buildPrompt` in `generate-article.js`):
  - Use only given facts; if sparse, write only what's known — no invented details.
  - **Never** invent crash/DNF reasons, accidents, illness, injuries, substance
    use or other personal incidents not in the input.
  - Negative events included **verbatim** ("kaatui" stays "kaatui").
  - Correct Finnish grammar / case inflection of names.
  - Category drives tone; plain body (no markdown/headings).

---

## Byline vs. identity

Two concepts that were previously conflated, now deliberately separate:

| | What it is | Source | Where it is stored |
|---|---|---|---|
| **Submitter** | Who pressed send — the legal counterparty | IAM session, never client-supplied | D1 `submissions.author_id` / `author_name` / `author_email` |
| **Byline** | The name printed on the public site | Contributor's choice | Markdown `author` + D1 `submissions.published_as` |

**How it works.** The contributor ticks (or leaves unticked) a single **Julkaise
nimettömänä** checkbox. The server resolves the byline in
`functions/api/submit-pikauutinen.js`:

- unticked → the session name
- ticked → `Photo & Moto` (the house byline)

The frontmatter therefore *always* holds a real value. "Anonymous" never means "empty
field" — an empty `author` would fail schema validation and break the production
build. Toimitus can still override the byline afterwards in Sveltia.

**Why the server resolves it rather than the contributor typing a name.** A free-text
author field was tried first and removed: typed names drift (`Photo&Moto Toimitus` vs
`Photo & Moto` vs lowercase), and anyone could type someone else's name. The session
already knows who is logged in, so it is both less work and more reliable.

**Why identity is never written to the markdown.** The content repo is public. A
contributor who chose anonymity would otherwise have their name published in git
history. Identity stays in D1 behind login, viewable in Julkaisujono.

**House byline is `Photo & Moto`** everywhere — the API fallback, the schema
preprocess, and the Sveltia default. Rows created before this work show
`published_as = NULL`; anonymity cannot be reconstructed for them.

---

## Security

- IAM sessions via `requireAuth` (`pm_session` cookie; 4-hour idle DB check).
- **Idle auto-logout** (`src/scripts/idle-timeout.js`): 30-min timeout, 5-min
  warning banner, resets on activity; imported on Toimituskeskus, Avustajat,
  Toimitus.
- Login rate limit: 5 failed/hour on production, 50 on staging/dev.
- Access-request: 3/IP/hour. Pikauutinen generation: 50/IP/hour.
- Author is always taken from the IAM session, never the form. `draft: true` and
  `source: ai_generated` are hardcoded server-side.

---

## What Was Built

### Phase 1 — Article submission ✅
- Avustajat page with login gate + card navigation + article form.
- `functions/api/submit-article.js` — validate, commit draft `.md` + images to
  `public/images/` via the GitHub App, Resend editor email.
- `functions/api/request-access.js` + `verify-access-request.js` — access flow.
- IAM `perm_laheta_artikkeli`, role-aware UI.

### Phase 2 — AI pikauutiset ✅
- "Luo pikauutinen" card/form on Avustajat.
- `functions/api/generate-article.js` — Gemini → validate → commit draft + photo
  to `public/images/` → Resend editor email.
- `pikauutiset` collection (`content.config.ts` + `config.yml`), collapsible
  public page, `/fi/pikauutiset` in main nav.

### Phase 3 — Hyväksynnät (editorial review queue) ✅ staging, pending production test
- `submissions` table in D1: `type` (artikkeli/pikauutinen), `status`
  (odottaa/julkaistu/hylatty), `author_id/name/email` (**the real submitter,
  always from the session**), `published_as` (**the byline it was published
  under**), `github_slug`, `reviewed_by`, `rejection_reason`, consent audit
  columns.
- `published_as` was added later via
  `ALTER TABLE submissions ADD COLUMN published_as TEXT;` run in the D1 console.
  There is no migration tooling in this repo — the schema is maintained by hand,
  so schema changes must be applied to production **before** deploying code that
  writes to the new column. Rows predating it are `NULL`.
- `functions/api/submissions.js` — `GET /api/submissions` (list, newest first);
  `POST /api/submissions` (reject only — requires `rejection_reason`, deletes
  the draft `.md` via GitHub App, emails author via Resend). Both require
  `hallitse_artikkeleita`. Approval is auto-detected by Julkaise sweep.
- Hyväksynnät card inside Toimitus on `yllapito.astro` (gated by
  `hallitse_artikkeleita`).

### Phase 4 — Byline choice + Julkaisujono ✅
- Free-text author field replaced by a **Julkaise nimettömänä** checkbox on both
  the Yleinen Kynä web form and the mobile app; the server resolves the byline.
  See *Byline vs. identity*.
- `submissions.published_as` records the byline separately from the submitter, so
  an anonymous byline never erases who actually sent the content.
- **Julkaisujono** page (`/fi/julkaisujono`) + 9th Toimitus card — the first UI
  that surfaces approved and rejected submissions, which Hyväksynnät hides.
- `content.config.ts` hardened so a missing author cannot break the build.
- House byline standardised to `Photo & Moto` across API, schema and Sveltia.

### Cross-cutting ✅
- Toimituskeskus hub, page renames, card navigation, idle timeout, env-aware
  emails, auto-provisioning email, 12-category alignment, Avustajan Ohjekirja,
  `avustaja` role + `perm_nahta_gemini_avain` in IAM code and `init.js`.
- **PWA** — `src/pages/fi/app.astro` at `/fi/app/`. Standalone light-theme
  Android home-screen app. Visual overhaul: white `theme-color` (#ffffff),
  `#ff7a00` orange tokens, responsive `.form-card` (max 620px centered),
  SVG nav icons, auto-expanding textareas (rAF-timed after screen visible),
  confirm screen flex-centered, `.flash-review-hidden { display: none !important }`
  specificity fix. Shared IAM session cookie, `laheta_artikkeli` gate, idle timeout.

---

## Technical Components

| Component | Location |
|---|---|
| Toimituskeskus hub | `src/pages/fi/toimitus.astro` |
| Avustajat page | `src/pages/fi/yleinen-kyna.astro` |
| Toimitus (admin) | `src/pages/fi/yllapito.astro` |
| Julkaisujono (submission history) | `src/pages/fi/julkaisujono.astro` |
| Pikauutiset feed | `src/pages/fi/pikauutiset.astro` |
| Avustajan Ohjekirja | `src/pages/fi/avustajan-ohjekirja.astro` |
| Verification landing | `src/pages/fi/vahvista-pyynto.astro` |
| PWA (Avustajan sovellus) | `src/pages/fi/app.astro` (`/fi/app/`) |
| Article handler | `functions/api/submit-article.js` |
| Pikauutinen generate | `functions/api/generate-article.js` |
| Pikauutinen submit | `functions/api/submit-pikauutinen.js` |
| Hyväksynnät (Phase 3) | `functions/api/submissions.js` |
| Access request | `functions/api/request-access.js` |
| Access verify | `functions/api/verify-access-request.js` |
| Julkaise hook | `functions/api/deploy.js` |
| User CRUD | `functions/api/auth/users.js`, `functions/api/auth/users/[id].js` |
| Auth lib / session | `functions/_lib/auth.js` |
| Schema bootstrap | `functions/api/auth/init.js` |
| Idle timeout | `src/scripts/idle-timeout.js` |
| Content schema | `src/content.config.ts` |
| CMS config | `public/admin/config.yml` |

### Infrastructure / secrets
- D1 (IAM + `access_requests` + `submissions`); staging binding `photoandmoto-community-dev`.
- `RESEND_API_KEY`, `GEMINI_API_KEY`, `GITHUB_APP_*` per environment.
- `DEPLOY_HOOK_STAGING` (ID `03d2296b-366c-4727-bccc-4020be41f281`) and
  `DEPLOY_HOOK_PRODUCTION` (ID `8d9229f6-2dc4-4cfd-bc4c-6ade1dbb4d74`) — both
  required; "Julkaise tuotantoon" fires the production hook directly.

---

## Planned / Backlog

### Phase 3 — Hyväksynnät ✅ built, pending production test
See "What Was Built" above. Production deploy pending.

### Infrastructure
- Sveltia → R2 media library; R2 custom subdomain; Astro `<Image />` for R2.
  See `INFRASTRUCTURE.md`.

### Smaller items
- **Full UI centering** — done for the simple gated pages (860px column);
  Toimitus tool sections intentionally use full width. Partial by design.

---

## Known Issues / Migration Notes

- **`avustaja` role on the live DB:** the IAM code and `init.js` support
  `avustaja`, but SQLite/D1 **cannot `ALTER` a CHECK constraint**. The existing
  `users` table must be **rebuilt** (create new table with
  `CHECK (role IN ('admin','editor','avustaja'))`, copy rows, drop, rename) on
  each live D1 before `avustaja` users can be created. `init.js` only affects
  freshly created databases. The users-table foreign key was removed from
  `init.js` to make this rebuild straightforward.
- **"← Takaisin" on ohjekirja pages:** reworked to a `<button>` + script handler
  using `history.back()`, with a fallback to `/fi/toimitus` when there is no
  history (e.g. opened in a new tab via `target="_blank"`). Verify on staging
  after redeploy.

---

*Last updated: June 2026 (v3.1)*
*Owner: Arto T Vilkman*
