# Photo & Moto — Deployment & Operations Guide

Operational reference for the Photo & Moto site: how it's hosted, how content
is edited and published, how to set up an environment from scratch, manage
secrets, and recover from incidents. This document is self-contained.

---

## Architecture at a glance

| Concern | Provider | Purpose |
|---|---|---|
| Source of truth | **GitHub** (`photoandmoto/photoandmoto`) | All code, gallery image files, article content |
| Static site hosting | **Cloudflare Pages** (2 projects) | Builds Astro on push, serves the result |
| Article editing | **Sveltia CMS** at `/admin/` | Git-based CMS for articles, GitHub-OAuth login |
| Mystery photos + galleries admin | **Custom admin** at `/fi/yllapito` | Photo identification, gallery management |
| Contributor + editorial system | **Toimituskeskus** at `/fi/toimitus` | Access requests, article + AI pikauutinen submission, Hyväksynnät review queue |
| PWA (mobile) | `src/pages/fi/app.astro` at `/fi/app/` | Standalone Android PWA for contributors |
| Server-side endpoints | **Cloudflare Pages Functions** (Workers runtime) | `/api/mystery/*`, `/api/auth/*`, `/api/submit-article`, `/api/generate-article`, `/api/submissions`, `/api/deploy`, `/oauth/*` |
| Database | **Cloudflare D1** (2 databases) | IAM (users, sessions, tokens), submissions, access requests, mystery photos, comments |
| Image storage | **Cloudflare R2** — bucket `photoandmoto-uploads` | Planned: editorial + contributor images (see `INFRASTRUCTURE.md`). Bucket exists; no images yet. |
| Transactional email | **Resend** | Access-request verification, provisioning links, rejection notifications |
| AI generation | **Gemini API** (`gemini-2.5-flash`) | Pikauutinen generation (`/api/generate-article`) + site search (`/api/search`) |
| Automation | **GitHub Actions** | Image processing, OG cards, link checks, deletion auto-promote |
| Worker → Repo writes | **GitHub App** (`Photoandmoto Publisher`) | JWT-signed atomic commits from the publish + rejection pipeline |

Two environments share this stack: **production** (`main` branch) and
**staging** (`dev` branch). Each has its own Pages project, its own copy of the
secrets, and **its own D1 database** — production binds the `DB` binding to
`photoandmoto-community`, staging binds it to `photoandmoto-community-dev`. So
IAM users, sessions, and the mystery photos/comments are **environment-specific**:
an account created on staging does not exist on production, and staging actions
never write to production data. (Schema migrations must therefore be run against
each database separately.)

---

## Environment map

| Environment | Branch | Cloudflare Pages project | URL | D1 database |
|---|---|---|---|---|
| Production | `main` | `photoandmoto` | www.photoandmoto.fi | `photoandmoto-community` |
| Staging | `dev` | `photoandmoto-staging` | photoandmoto-staging.pages.dev | `photoandmoto-community-dev` (separate from prod) |

**Working rule:** all changes go to `dev` first, get verified on the staging
URL, then a PR `dev → main` promotes them. Direct pushes to `main` are
reserved for documentation-only changes or hotfixes.

---

## Content management

The site has **two separate admin systems** by deliberate design:

### Articles — Sveltia CMS at `/admin/`

Articles (the Aikakone / Time Machine content) are edited in **Sveltia CMS**,
a git-based CMS served as static files from `public/admin/`.

- **URL:** `https://www.photoandmoto.fi/admin/`
- **Login:** GitHub OAuth. The editor must have write access to the repo.
- **Where edits go:** Sveltia commits straight to the `dev` branch. Cloudflare
  rebuilds staging automatically. To reach production, promote `dev → main`.
- **Collections:**
  - **Artikkelit** — browse and edit all articles, create blank ones
  - **+ Uusi MXGP-juttu** / **+ Uusi historiallinen tarina** — Quick Add
    templates: pre-filled category, tags, and body skeleton
  - **Kategoriat** — article categories (data-driven; add new ones here)
- **Bilingual:** Sveltia uses `i18n: multiple_folders`. One entry has FI and EN
  locales; files are written to `src/content/articles/fi/<slug>.md` and
  `src/content/articles/en/<slug>.md` with the same slug.
- **FI required, EN optional:** new entries start FI-only (`initial_locales:
  default`). The editor enables English per entry from the ⋯ menu (top-right of
  the editor) when a translation is wanted. Required fields (`title`, `body`,
  `seo_description`) use `required: [fi]`, so an article can be published FI-only
  or FI+EN. FI is the always-on default locale, so EN-only isn't possible.
- **Local testing:** `local_backend: true` is set in `public/admin/config.yml`.
  Run `npm run dev`, open `http://localhost:4321/admin/`, and choose **Work
  with Local Repository** (Chromium browsers) to edit files on disk — no OAuth
  and no proxy process needed.

### Mystery photos + galleries — custom admin at `/fi/yllapito`

The "Tunnista kuva" photo-identification flow and gallery management remain in
the original custom admin.

- **URL:** `https://www.photoandmoto.fi/fi/yllapito`
- **Login:** per-user IAM — each editor has their own email + password + 5
  permission flags. See § Identity & access management (IAM) below for the
  full breakdown. A legacy `UPLOAD_PASSWORD` shared-password fallback is
  still accepted on `/api/mystery/*` during the rollout window and will be
  removed in a follow-up.
- Backed by `functions/api/mystery/*` and Cloudflare D1.

### Contributor & editorial system — Avustajat / Toimituskeskus

Built on the same IAM + GitHub App + D1 stack as the custom admin above.
**`/fi/toimitus` (Toimituskeskus)** is the single entry point — linked from the
Muuta dropdown — from which users reach **Toimitus** (`/fi/yllapito`, the admin
above) and/or **Avustajat** (`/fi/yleinen-kyna`, contributor article + AI
"pikauutinen" forms). It adds the `avustaja` role, the `perm_laheta_artikkeli`
and `perm_nahta_gemini_avain` permissions (IAM now has **7** permission flags,
not 5), an email-verified access-request flow (D1 `access_requests` table), and
the public `/fi/pikauutiset` feed.

**See `YLEINEN_KYNA.md` (v3.0) for the full design and current built state, and
`INFRASTRUCTURE.md` for the image-storage roadmap.**

### Article frontmatter reference

Articles are Markdown with YAML frontmatter, validated by Zod in
`src/content.config.ts`:

| Field | Type | Notes |
|---|---|---|
| `title` | string, required | |
| `subtitle` | string, optional | |
| `author` | string | defaults to `Photo & Moto` |
| `date` | date, required | `YYYY-MM-DD` |
| `category` | string | must match a `name` in the categories collection |
| `tags` | string array | |
| `featured_image` | string, optional | `/images/<file>` path |
| `card_image` | string, optional | overrides featured_image on list/cards |
| `show_hero` | boolean | default `true` |
| `image_caption` | string, optional | |
| `language` | `fi` \| `en`, optional | derived from folder; field is legacy |
| `draft` | boolean | default `false`; `true` hides the article from the site |
| `seo_description` | string ≤160, optional | |
| `sources` | string, optional | "Lähteet" block; URLs auto-link on render |

The CMS may write `null` for empty optional fields — the schema accepts that
via `.nullish()`. Booleans coerce `null` to their default via `z.preprocess()`.

---

## Setting up a new environment from scratch

If you ever need to reproduce production (disaster recovery, fork a clone, set
up a third environment), here's the full sequence.

### 1. Cloudflare Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. Select GitHub account → repo `photoandmoto/photoandmoto`
3. Branch: `main` (or `dev` for staging)
4. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: leave blank
5. Save and deploy. First build takes ~2 minutes.

### 2. Cloudflare D1 database

1. Cloudflare dashboard → **Workers & Pages** → **D1**
2. **Create database** → `photoandmoto-community` for production, or
   `photoandmoto-community-dev` for staging (each environment binds `DB` to its own)
3. After creation, in **Settings**, copy the database ID
4. Bind it to the Pages project:
   - Pages project → **Settings** → **Functions** → **D1 database bindings**
   - Variable name: `DB`
   - Database: select the one you just created
5. Two separate schema bootstraps:
   - `functions/api/mystery/init.js` — mystery photos + comments tables.
     Runs on first hit to any mystery endpoint.
   - `functions/api/auth/init.js` — IAM + submissions tables (users, sessions,
     provisioning_tokens, login_attempts, recovery_attempts, access_requests,
     submissions, photo_submissions). Runs lazily on first auth API hit.
   No manual SQL needed. To inspect: `PRAGMA table_info(<table>)` in D1 console.

### 3. Pages project secrets

In Pages project → **Settings** → **Environment variables** → **Production**
(and **Preview** if you want them on PR previews too):

| Secret | Required | What it is |
|---|---|---|
| `UPLOAD_PASSWORD` | yes (transitional) | Legacy shared password for `/api/mystery/*` endpoints. Still accepted alongside IAM session cookies during the rollout window. Will be removed in a follow-up. |
| `GITHUB_APP_ID` | yes | Numeric ID of the `Photoandmoto Publisher` GitHub App. |
| `GITHUB_APP_INSTALLATION_ID` | yes | Numeric installation ID for that App on the `photoandmoto` repo. |
| `GITHUB_APP_PRIVATE_KEY` | yes | Full PEM contents of the App's private key, including the `-----BEGIN/END-----` lines. |
| `GEMINI_API_KEY` | yes | Google AI Studio key for Gemini `gemini-2.5-flash`. Used by `generate-article.js` (JSON mode, 8192 tokens, 50 req/IP/hour) and `search.js` (no JSON mode, 1500 tokens). The MXGP scraper Action also uses this — see step 6. |
| `RESEND_API_KEY` | yes | Resend API key. Powers all transactional email: access-request verification, provisioning links, submission confirmations, rejection notifications. Without this, emails silently fail but the operations complete (non-fatal). |
| `DEPLOY_HOOK_STAGING` | yes | Cloudflare Pages deploy-hook URL for the staging project. ID: `03d2296b-366c-4727-bccc-4020be41f281`. Powers **Julkaise esikatseluun** (`functions/api/deploy.js`). |
| `DEPLOY_HOOK_PRODUCTION` | yes | Cloudflare Pages deploy-hook URL for the production project. ID: `8d9229f6-2dc4-4cfd-bc4c-6ade1dbb4d74`. Powers **Julkaise tuotantoon** (`functions/api/deploy.js`) — fires the hook instead of merging dev→main. |
| `OAUTH_GITHUB_CLIENT_ID` | yes (prod) | GitHub OAuth App client ID — powers Sveltia login. |
| `OAUTH_GITHUB_CLIENT_SECRET` | yes (prod) | GitHub OAuth App client secret. **Encrypt this.** |
| `OAUTH_REDIRECT_URI` | yes (prod) | `https://www.photoandmoto.fi/oauth/callback` |
| `SUPER_ADMIN_EMAIL` | one-shot | Email of the first IAM superadmin to seed. Used only once per environment. Remove after seeding. |
| `SUPER_ADMIN_FIRST_NAME` | one-shot | First name for the seeded superadmin. Remove after seeding. |
| `SUPER_ADMIN_LAST_NAME` | one-shot | Last name for the seeded superadmin. Remove after seeding. |
| `SUPER_ADMIN_SEED_SECRET` | one-shot, recommended | Defence-in-depth shared secret. If set, `POST /api/auth/seed-superadmin` requires `{ seed_secret: "..." }` in the body. Remove after seeding. |

All secrets must be marked **Encrypt** in the dashboard. After adding/changing
any secret, the next deployment picks it up; running deployments keep using the
old values until a new build finishes.

The `OAUTH_*` secrets are production-only — Sveltia's OAuth callback URL is
registered for the production domain. Staging Sveltia testing uses
`local_backend` instead (see "Content management" above).

### 4. GitHub App — `Photoandmoto Publisher` (for the publish pipeline)

This App lets Cloudflare Workers commit to the repo (mystery photo publishing,
gallery derivative generation). If it already exists, skip to "Get the
credentials". To create it from scratch:

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**
2. Name: `Photoandmoto Publisher`
3. Homepage URL: `https://www.photoandmoto.fi`
4. Webhook: **uncheck "Active"**
5. Repository permissions: **Contents** Read and write; **Metadata** Read-only
6. Where can this App be installed: **Only on this account**
7. Create the App, generate a private key (downloads a `.pem`)
8. Install the App on the `photoandmoto/photoandmoto` repo

**Get the credentials** → `GITHUB_APP_ID` (App settings page),
`GITHUB_APP_INSTALLATION_ID` (in the install URL `/installations/<NUMBER>`),
`GITHUB_APP_PRIVATE_KEY` (the `.pem` contents).

### 5. GitHub OAuth App — for Sveltia CMS login

This is **separate** from the GitHub App above. GitHub Apps and OAuth Apps are
different things; the OAuth App authenticates the human editor logging into
Sveltia.

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**
2. Application name: `Photo & Moto — Sveltia CMS`
3. Homepage URL: `https://www.photoandmoto.fi`
4. Authorization callback URL: `https://www.photoandmoto.fi/oauth/callback`
   (exact — no trailing slash)
5. Register, copy the **Client ID**, generate a **Client Secret**
6. These become `OAUTH_GITHUB_CLIENT_ID` and `OAUTH_GITHUB_CLIENT_SECRET`

The OAuth proxy itself runs as Cloudflare Pages Functions at
`functions/oauth/auth.js` and `functions/oauth/callback.js`.

### 6. GitHub repo secrets — for GitHub Actions

The MXGP scraper Action runs on GitHub's infrastructure, so it needs the Gemini
key as a **repo secret** (separate from the Cloudflare copy):

1. GitHub → repo `photoandmoto/photoandmoto` → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret** → name `GEMINI_API_KEY` → paste the Google AI
   Studio key
3. For the `auto-promote-deletions` Action, add the `Photoandmoto Publisher`
   App credentials as **repo Actions secrets** (the `GITHUB_` prefix is reserved
   for Actions secrets, so these differ from the Cloudflare names):
   - `PUBLISHER_APP_ID` — same value as the Cloudflare `GITHUB_APP_ID`
   - `PUBLISHER_APP_PRIVATE_KEY` — same PEM as `GITHUB_APP_PRIVATE_KEY`

### 7. Custom domain (production only)

1. Pages project → **Custom domains** → **Set up a custom domain**
2. Enter `www.photoandmoto.fi`
3. If the domain is in Cloudflare, DNS is auto-configured. Otherwise follow the
   on-screen registrar instructions.
4. SSL provisioning is automatic once DNS resolves.

### 8. Verify

- Visit the URL → site renders
- Hit `/api/mystery/featured` → returns JSON (Pages Functions + D1 binding work)
- Visit `/fi/yllapito` → the new login form (email + password) is shown
- Visit `/admin/` → Sveltia loads; "Login with GitHub" completes; collections show
- In Sveltia, edit an article → a commit lands on `dev` authored by your user

For a brand-new environment, no IAM users exist yet — you must seed the
first superadmin before login works. See § Identity & access management (IAM)
below.

---

## Identity & access management (IAM)

The `/fi/yllapito` admin is gated by a per-user IAM system. Each editor has
an email + password and a set of permission flags (`tarkista`, `lahetakuva`,
`hallitse_galleriaa`, `hallitse_artikkeleita`, `admin_iam`). Login returns a
signed 30-day session cookie. Schema (`users`, `provisioning_tokens`,
`recovery_attempts`) is bootstrapped lazily by `functions/api/auth/init.js` on
the first auth API hit.

Design rationale is in [IAM_DESIGN.md](IAM_DESIGN.md). User-facing manual
(login flow, recovery, Käyttäjät tab walkthrough) is in
[JULKAISIJAN_OHJEET.md](JULKAISIJAN_OHJEET.md) § Käyttäjätilit ja oikeudet.

### Bootstrapping the first super-admin (new environments only)

A fresh environment has zero users in `users`. The site loads fine for the
public, but nobody can log into `/fi/yllapito`. One-time bootstrap:

1. Set 4 env vars on the Pages project (Production environment):
   - `SUPER_ADMIN_EMAIL` (e.g. `photoandmoto@gmail.com`)
   - `SUPER_ADMIN_FIRST_NAME`
   - `SUPER_ADMIN_LAST_NAME`
   - `SUPER_ADMIN_SEED_SECRET` — generate a random GUID, save it for step 3
2. Trigger a redeploy (Deployments → latest → ⋯ → Retry deployment), wait
   ~2 min for env vars to activate
3. POST to the seed endpoint with the secret:
   ```powershell
   $body = '{"seed_secret":"<your-guid>"}'
   Invoke-RestMethod -Uri "https://www.photoandmoto.fi/api/auth/seed-superadmin" `
     -Method Post -Body $body -ContentType "application/json"
   ```
   Response includes `success: true`, `user.id: 1`, and a one-time
   `provisioning_link`. Copy that link.
4. Open the link in your browser → set password + 3 security questions on
   `/fi/aseta-salasana` → submit
5. Verify login works: `POST /api/auth/login` with email + password should
   return `{ success: true, user: {...} }`
6. **Remove all 4 `SUPER_ADMIN_*` env vars** from the Pages project. The
   endpoint is already self-locked by the no-prior-users check, but removing
   the vars is hygiene.

The seed endpoint is idempotent: it refuses to run if any user exists. To
re-seed from scratch, you must first delete all rows from `users` in D1.

### Routine user management

Day-to-day user CRUD lives in the Käyttäjät tab on `/fi/yllapito` (visible to
users with `admin_iam`). The endpoints under `functions/api/auth/` are
session-authenticated; no separate admin password.

- **Add user:** + Lisää uusi käyttäjä → fill form → a one-time 7-day
  provisioning link is shown. Send it to the user out-of-band (email, Slack,
  whatever). They activate by setting password + security questions on
  `/fi/aseta-salasana`.
- **Edit user:** Muokkaa — changes name, role, permissions. Email is locked
  (immutable after creation).
- **Regenerate provisioning link:** Uusi linkki — invalidates any previous
  link, clears the user's password + security questions, generates a new
  7-day link. Use when a user forgets their security answers or you suspect
  account compromise. Also reactivates a deactivated user.
- **Deactivate user:** Poista — ends the user's session immediately, prevents
  future login. Does not delete the row (history preserved). The last active
  `admin_iam` user is protected from deactivation to prevent lockout.
- **Audit log:** the Käyttäjät tab includes a `Palautusloki` (recovery
  attempts) section, lazy-loaded on expand. Shows the last 50 attempts —
  email tried, IP, timestamp, success/fail. Watch for clusters of failed
  attempts from unfamiliar IPs.

### Removing the legacy `UPLOAD_PASSWORD` fallback

During the IAM rollout, `/api/mystery/*` endpoints accept either a session
cookie OR the legacy `UPLOAD_PASSWORD`. Once IAM has been stable in
production for 24–48h, remove the fallback:

1. Delete `functions/api/mystery/verify.js`
2. In `functions/api/mystery/{upload,admin,publish,gallery-manage,galleries}.js`,
   replace `requireAuthOrLegacyPassword` with `requireAuth`
3. Remove `requireAuthOrLegacyPassword` from `functions/_lib/auth.js`
4. Remove the `verifyPw()` helper from `src/pages/fi/yllapito.astro` (dead code)
5. After the change deploys, remove `UPLOAD_PASSWORD` env var from both
   environments

A shared draft of this is tracked in IAM Phase 7.

---

## GitHub Actions reference

All workflows live in `.github/workflows/`. They run on push to `dev` and
`main`, scoped by path filters.

| Workflow | Trigger path | What it does |
|---|---|---|
| `compress-article-images.yml` | `public/images/**` | Resizes oversized images to ≤1600px wide, re-encodes JPEG/WebP at quality 82. Commits compressed versions. |
| `generate-og-images.yml` | `src/content/articles/**` | Composites a 1200×630 branded social card per article (`scripts/generate-og-image.mjs`, Sharp + Montserrat). Commits to `public/og/`. |
| `check-links.yml` | `src/content/articles/**` | Scans changed article markdown for broken external links. Fails the run (visible warning) if any are dead. Doesn't block deploys. |
| `process-gallery-image.yml` | `public/galleries/**` | Generates thumb + display renditions for new gallery images, updates the manifest. |
| `auto-promote-deletions.yml` | `src/content/articles/**` (push to `dev`) | If a push to `dev` deletes article files, merges `dev → main` via the Publisher GitHub App so the deletion reaches production automatically. |
| `mxgp-scraper.yml` | scheduled | Refreshes MXGP results/standings data. |

**Loop guards:** Actions that commit back use a commit-message prefix or a
path-filter mismatch so their own commits don't re-trigger them. If you change
a workflow's commit message, update its loop guard to match.

---

## Routine ops

### Deploying changes

Push to a branch — Pages deploys automatically. Build logs are in
**Workers & Pages** → project → **Deployments**.

For schema-coupled D1 changes, **migrate the D1 schema BEFORE merging the PR.**
If code deploys first and queries a missing column, mystery endpoints fail.
Pattern: run `ALTER TABLE` in the D1 console, verify with
`PRAGMA table_info(<table>)`, then merge.

### Editing and publishing articles

1. Open `https://www.photoandmoto.fi/admin/`, log in with GitHub.
2. Create or edit an article. For new articles, use a Quick Add template or
   the blank **Artikkelit → New**.
3. **Watch the `Piilota sivustolta` toggle** — if it's ON (`draft: true`), the
   article is excluded from the build and won't appear on the site. Leave it
   OFF for normal publishing.
4. To create the English version: fill the FI locale, switch to the EN locale,
   and translate the content by hand with Gemini (paste the FI text into
   Gemini, paste the result into the matching EN fields), review, and save.
5. Sveltia commits to `dev` → staging rebuilds automatically.
6. **Preview and publish from the Julkaise tab** in `/fi/yllapito` (editors):
   - **Julkaise esikatseluun** — triggers a staging rebuild; preview at
     `photoandmoto-staging.pages.dev`.
   - **Julkaise tuotantoon** — fires `DEPLOY_HOOK_PRODUCTION` via
     `functions/api/deploy.js`, triggering a fresh production build without
     merging dev→main. Developers can also promote with a manual cherry-pick
     to `main`.
   - **Deletions auto-publish:** deleting an article in Sveltia triggers the
     `auto-promote-deletions` Action, which merges `dev → main` automatically —
     no Julkaise tuotantoon needed.

**Verifying what's actually committed:** the Sveltia UI and live pages can show
stale/cached content. The authoritative check is
`git show origin/dev:src/content/articles/<lang>/<slug>.md`.

### Managing categories

Categories are a Sveltia collection (`src/content/categories/*.json`). To add
one: Sveltia → **Kategoriat** → New. To retire one: first reassign every article
using it, verify nothing references it, then delete the JSON file. The
collection's `name` field is the value stored in articles — never change it on
an in-use category.

### Inspecting / editing D1

Cloudflare dashboard → **Workers & Pages** → **D1** → select database →
**Console**. Standard SQLite. Read queries are free; writes count toward quota.

```sql
-- Health check: how many photos in each state
SELECT status, COUNT(*) FROM photos GROUP BY status;

-- Photos pending publish (identified, not yet in a gallery)
SELECT id, filename, year_estimate, people FROM photos
WHERE status = 'identified' AND published_to_gallery_at IS NULL;

-- Recent comments
SELECT * FROM comments ORDER BY created_at DESC LIMIT 20;
```

### Rotating a secret

1. Cloudflare Pages project → **Settings** → **Environment variables** → edit the secret → **Save**
2. **Trigger a redeploy** (Deployments → **Retry deployment** on the latest) — running deployments don't pick up secret changes until the next build.

For `GITHUB_APP_PRIVATE_KEY`: generate the new key in GitHub App settings,
paste the full PEM, then delete the old key — in that order (deployed code
still uses the old key until the next build).

For `OAUTH_GITHUB_CLIENT_SECRET`: regenerate in the GitHub OAuth App, update
the Cloudflare secret, redeploy. Sveltia logins fail until the redeploy finishes.

### Pushing a hotfix to production

When `dev` is dirty but you need to fix something live:

```bash
git checkout main && git pull
git checkout -b hotfix/<short-name>
# ...make the fix...
git commit -am "hotfix: <description>"
git push origin hotfix/<short-name>
# Open PR hotfix/<short-name> → main, review, merge
git checkout main && git pull
git checkout dev && git merge main && git push   # bring the fix into dev too
```

---

## SEO operations

The site is fully SEO-instrumented (titles, descriptions, canonical, hreflang,
OG, Twitter, JSON-LD Organization + WebSite + Article, GA4, sitemap). New
articles get all of it automatically. Per-article social cards are generated
by `generate-og-images.yml` and referenced via `ArticleLayout.astro`.

### Where things live

| Asset | Location | Notes |
|---|---|---|
| Sitemap | https://www.photoandmoto.fi/sitemap-index.xml | Auto-generated each build by `@astrojs/sitemap` |
| robots.txt | `public/robots.txt` | Static — allows all, points to sitemap |
| Root redirect | `public/_redirects` | Cloudflare Pages 301: `/` → `/fi` |
| GA4 measurement ID | `G-9Y0PEJY0XG` (in `src/layouts/BaseLayout.astro`) | Hardcoded; site-wide |
| OG cards | `public/og/<slug>-<lang>.jpg` | Generated by the OG-images Action |
| GSC property | `photoandmoto.fi` (Domain property) | Verified owners: `atvilkman`, Lars Lönneberg |

### What to check periodically

- **GSC Performance** (weekly) — top queries, CTR, average position.
- **GSC Indexing → Pages** (monthly) — indexed count should trend up.
- **GSC Enhancements → Articles** (after publishing) — confirms rich-result eligibility.

### When GSC reports "Discovered – currently not indexed"

Normal post-deploy behavior. To accelerate: GSC → paste the URL → inspect →
**Request indexing** (~10 URLs/day limit). Prioritize article pages.

### When GSC reports "Redirect error" / "robots.txt 404"

Usually stale. Verify with curl first:

```powershell
curl.exe -sIL "https://www.photoandmoto.fi/<path>" | Select-String -Pattern "^HTTP|^Location"
```

If curl shows a clean redirect chain, click **Validate Fix** in GSC.

### Apex domain redirect

`photoandmoto.fi` (no www) is hosted at Domainkeskus and uses a server-side
.htaccess 301 to `https://www.photoandmoto.fi`. If apex starts 404ing or shows
the Domainkeskus parking page, contact Domainkeskus support (reference ticket
#129612, Joel).

---

## Backup and restore

| Asset | Backup status | How |
|---|---|---|
| Code, gallery images, articles | ✅ | Git history on GitHub |
| D1 mystery photos table | ⚠️ | Not backed up automatically. D1 time-travel gives 30-day point-in-time recovery, no exported snapshots. |
| D1 comments table | ⚠️ | Same |
| D1 IAM tables (users, sessions, provisioning_tokens, login_attempts, recovery_attempts) | ⚠️ | Same. Password hashes are bcrypt'd so an export is sensitive but not directly usable. |
| D1 submissions + access_requests + photo_submissions tables | ⚠️ | Same. Export monthly alongside other D1 tables. |
| Pages secrets | ❌ | Stored only in Cloudflare. Keep the GitHub App `.pem`, OAuth secret, `RESEND_API_KEY`, and `UPLOAD_PASSWORD` in a password manager. |

### Manual D1 export (recommended monthly)

```bash
# Requires wrangler CLI installed and authenticated
wrangler d1 export photoandmoto-community --output photos-backup.sql
```

Store the `.sql` outside the repo — it contains base64 image data and can be
large.

### Restoring D1 from time-travel

Cloudflare dashboard → **D1** → database → **Time travel** → pick a timestamp →
**Restore**. Available for 30 days.

---

## Troubleshooting

### Build fails on Cloudflare

Open the deployment → **Build log**. Common causes:

- **Article fails schema validation** — a frontmatter field doesn't match the
  Zod schema in `src/content.config.ts`. The error names the file and field.
- **Missing image referenced in an article** — `featured_image` path doesn't
  exist under `public/images/`.
- **Invalid JSON in a gallery manifest** — missing/trailing comma in
  `src/content/galleries/<slug>.json`.
- **D1 schema mismatch** — an endpoint queries a column that doesn't exist yet.

### Sveltia CMS won't load or login fails

- **`/admin/` 404 locally** — Astro dev doesn't auto-resolve directory
  indexes; use `/admin/index.html`. Production (`/admin/`) is fine.
- **OAuth login fails** — check the callback URL in the GitHub OAuth App is
  exactly `https://www.photoandmoto.fi/oauth/callback`, and that
  `OAUTH_GITHUB_CLIENT_ID/SECRET` are set on the production Pages project. The
  popup error page reports the specific failure (state mismatch, token
  exchange, etc.).
- **Sveltia shows stale state / wrong values** — clear browser
  localStorage for the admin origin; Sveltia caches pending edits across sessions.

### Gemini / AI pikauutinen call fails

`/api/generate-article` calls `gemini-2.5-flash`. Common causes of the
502 "Tekoälyn vastaus epäonnistui" response:

- **AbortError** — the 20 s timeout fired. Gemini was slow; retry.
- **Gemini 429** — quota exhausted (in-memory rate limit is 50/IP/hour;
  project-level Gemini quota may also apply). The response body includes
  the specific error.
- **Gemini 503** — overloaded; the function retries once automatically.
- **JSON parse failure** — Gemini returned non-JSON despite the prompt.
  Check real-time logs for the raw response. `parseGeminiJson` handles
  fenced code blocks and loose text, but occasionally the model adds prose.
- **GEMINI_API_KEY missing or wrong** — returns a Gemini 400/403.

To inspect live: Workers & Pages → project → **Functions** → **Real-time logs**.

### Resend email not sending

`RESEND_API_KEY` is missing or expired. All email operations are non-fatal —
the underlying D1 write already succeeded. Add or rotate the key in Cloudflare
secrets (Production + Preview), then **Retry deployment** to activate it.
Check Resend dashboard for delivery logs.

### Contributor submission not appearing in Hyväksynnät

The `submissions` table row is written by `functions/api/submit-article.js`
(for articles) and `functions/api/submit-pikauutinen.js` (for pikauutiset).
Check D1 console:

```sql
SELECT id, type, status, title, submitted_at FROM submissions ORDER BY submitted_at DESC LIMIT 20;
```

If the row is there but missing from the Hyväksynnät card, the session cookie
may lack `hallitse_artikkeleita`. Check the user's permissions in the Käyttäjät
tab.

### An article saved in Sveltia but doesn't appear on the site

Most likely `draft: true` (the `Piilota sivustolta` toggle was ON). Astro
excludes drafts from `getStaticPaths()`, so no page is generated and Cloudflare
keeps serving the previous deployment's cached page — a silent un-publish.
Verify with `git show origin/dev:src/content/articles/<lang>/<slug>.md`.

### English translation is missing for an article

Translation is **manual**. If an article has no English version, an editor
simply hasn't created one yet: open the article in Sveltia, enable the EN locale
(⋯ menu), translate the fields by hand (with Gemini), and save. There is nothing
server-side that produces translations.

### Site loads but mystery endpoints 500

Almost always: missing/wrong D1 binding (`DB` variable name), missing GitHub
App secret, or schema not yet bootstrapped (hit `/api/mystery/init` once).
Cloudflare Pages → project → **Functions** → **Real-time logs** shows stack
traces.

### Cloudflare Pages secret changed but Worker still uses old value

Secrets only refresh on a new build. Deployments → **Retry deployment** on the
latest to force a rebuild.

---

## Backlog and known issues

- **D1 growth monitoring** — no automated alerting for table size yet.
- **Original-image archive strategy** — the repo will eventually outgrow
  GitHub's recommended size; R2 / cold storage is a future decision.

---

## License

© 2026 Photo & Moto — All rights reserved.
