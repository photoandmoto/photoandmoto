# Photo & Moto — Deployment & Operations Guide

Operational reference for setting up environments, managing secrets, recovering from incidents, and routine ops. For the day-to-day workflow (adding articles, galleries, publishing photos) see `README.md`.

---

## Architecture at a glance

| Concern | Provider | Purpose |
|---|---|---|
| Source of truth | **GitHub** (`photoandmoto/photoandmoto`) | All code, all gallery image files, all article content |
| Static site hosting | **Cloudflare Pages** (2 projects) | Builds Astro on push, serves the result |
| Server-side endpoints | **Cloudflare Pages Functions** (Workers runtime) | `/api/mystery/*` for community features |
| Database | **Cloudflare D1** (2 databases) | Mystery photos table, comments table |
| Image processing | **GitHub Actions** + Sharp | Thumbnails, display-size renditions, watermark, manifest update |
| Worker → Repo writes | **GitHub App** (`Photoandmoto Publisher`) | JWT-signed atomic commits from the publish pipeline |

Two environments share this stack: **production** (`main` branch) and **staging** (`dev` branch). Each has its own Pages project, its own D1 database, and its own copy of the secrets — but the same GitHub App is used by both (it commits to whichever branch the worker detects via `CF_PAGES_BRANCH`).

---

## Environment map

| Environment | Branch | Cloudflare Pages project | URL | D1 database |
|---|---|---|---|---|
| Production | `main` | `photoandmoto` | www.photoandmoto.fi | `photoandmoto-community` |
| Staging | `dev` | `photoandmoto-staging` | photoandmoto-staging.pages.dev | `photoandmoto-community-dev` |

**Working rule:** all changes go to `dev` first, get verified on the staging URL, then a PR `dev → main` promotes them. Direct pushes to `main` are reserved for documentation-only changes or hotfixes.

---

## Setting up a new environment from scratch

If you ever need to reproduce production (disaster recovery, fork a clone, set up a third environment), here's the full sequence.

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
2. **Create database** → name it `photoandmoto-community` (or `-dev` for staging)
3. After creation, in **Settings**, copy the database ID
4. Bind it to the Pages project:
   - Pages project → **Settings** → **Functions** → **D1 database bindings**
   - Variable name: `DB`
   - Database: select the one you just created
5. Schema bootstrap is handled by `functions/api/mystery/init.js` — first hit to any mystery endpoint will create tables. No manual SQL needed for a fresh setup. (Reference schema is in `README.md` if you want to verify or run it manually.)

### 3. Pages project secrets

In Pages project → **Settings** → **Environment variables** → **Production** (and **Preview** if you want them on PR previews too):

| Secret | Required | What it is |
|---|---|---|
| `UPLOAD_PASSWORD` | yes | Plain-text password for the Tunnista kuva admin login. Pick something strong; this is the only thing protecting the admin endpoints. |
| `GEMINI_API_KEY` | optional | Google AI Studio key, used for the AI-suggestion fallback when admin asks Gemini to identify a photo. Site works without it — that one button just becomes inactive. |
| `GITHUB_APP_ID` | yes | Numeric ID of the `Photoandmoto Publisher` GitHub App. |
| `GITHUB_APP_INSTALLATION_ID` | yes | Numeric installation ID for that App on the `photoandmoto` repo. |
| `GITHUB_APP_PRIVATE_KEY` | yes | Full PEM contents of the App's private key, including the `-----BEGIN/END-----` lines. Paste as-is — Cloudflare handles the multi-line value. |

All secrets must be marked **Encrypt** in the dashboard. After adding/changing any secret, the next deployment picks it up; existing running deployments keep using the old values until a new build finishes.

### 4. GitHub App (one-time setup; reused across environments)

If the App `Photoandmoto Publisher` already exists, skip to "Get the credentials" below. To create it from scratch:

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**
2. Name: `Photoandmoto Publisher`
3. Homepage URL: anything (e.g. `https://www.photoandmoto.fi`)
4. Webhook: **uncheck "Active"** — we don't need webhooks
5. Repository permissions:
   - **Contents**: Read and write
   - **Metadata**: Read-only (auto-included)
6. Where can this App be installed: **Only on this account**
7. Create the App
8. Generate a private key — downloads a `.pem` file. Keep it safe; this is the credential the Worker uses to sign JWTs.
9. Install the App on the `photoandmoto/photoandmoto` repo (App settings → **Install App** → pick the org → **Only select repositories**)

**Get the credentials:**

- App ID: shown on the App's settings page
- Installation ID: visible in the URL after you install (`/installations/<NUMBER>`), or via the API
- Private key: the `.pem` file you downloaded

These three become `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`.

### 5. Custom domain (production only)

1. Pages project → **Custom domains** → **Set up a custom domain**
2. Enter `www.photoandmoto.fi`
3. If the domain is in Cloudflare, DNS is auto-configured. If not, follow the on-screen registrar instructions.
4. SSL provisioning is automatic once DNS resolves.

### 6. Verify

- Visit the URL → site renders
- Hit `/api/mystery/featured` → returns JSON (proves Pages Functions + D1 binding work)
- Log in to Tunnista kuva with `UPLOAD_PASSWORD` → admin UI appears
- Upload a photo → row appears in D1
- Publish the photo → GitHub Action runs → photo appears in gallery after rebuild

If any step fails, see "Troubleshooting" below.

---

## Routine ops

### Deploying changes

Push to a branch — Pages deploys automatically. Build logs are in **Workers & Pages** → project → **Deployments** → click any deployment.

For schema-coupled changes (new D1 column, new endpoint that depends on one), **migrate the D1 schema BEFORE merging the PR.** If code deploys first and tries to query a missing column, mystery endpoints will start failing. Pattern that's worked well:

1. Run `ALTER TABLE` in Cloudflare D1 console for the live database
2. Verify with `PRAGMA table_info(<table>)`
3. Then merge the PR
4. Cloudflare auto-deploys the new code, which now matches the schema

### Inspecting / editing D1

Cloudflare dashboard → **Workers & Pages** → **D1** → select database → **Console**. Standard SQLite syntax. Read queries are free; writes count toward the D1 quota.

Useful queries:

```sql
-- Health check: how many photos in each state
SELECT status, COUNT(*) FROM photos GROUP BY status;

-- Photos pending publish (identified, not yet in a gallery)
SELECT id, filename, year_estimate, people FROM photos
WHERE status = 'identified' AND published_to_gallery_at IS NULL;

-- Mystery photos with thumbs (drives the landing-page block)
SELECT COUNT(*) FROM photos
WHERE thumb_data IS NOT NULL
  AND status != 'identified'
  AND published_to_gallery_at IS NULL;

-- Recent comments
SELECT * FROM comments ORDER BY created_at DESC LIMIT 20;
```

### Rotating a secret

1. Cloudflare Pages project → **Settings** → **Environment variables** → click the secret → **Edit**
2. Paste the new value → **Save**
3. **Trigger a redeploy** (Deployments tab → **Retry deployment** on the latest one) — running deployments don't pick up secret changes until the next build.

For `GITHUB_APP_PRIVATE_KEY`: generate a new key in the GitHub App settings, paste the full PEM, then delete the old key in GitHub. Don't delete the old key first — there's a window where deployed code still uses it.

For `UPLOAD_PASSWORD`: change in Cloudflare, redeploy, communicate the new password out of band. There's no password-reset flow for the admin user.

### Pushing a hotfix to production

When `dev` is dirty (has unfinished work) but you need to fix something live:

```bash
git checkout main
git pull
git checkout -b hotfix/<short-name>
# ...make the fix...
git commit -am "hotfix: <description>"
git push origin hotfix/<short-name>
# Open PR from hotfix/<short-name> → main, review, merge
git checkout main && git pull
# Optional but recommended: bring the fix into dev too
git checkout dev && git merge main && git push
```

This avoids polluting `dev` with mid-progress code if the fix needs to ship now.

---

## Backup and restore

### What is and isn't backed up automatically

| Asset | Backup status | How |
|---|---|---|
| Code | ✅ | Git history on GitHub |
| Gallery images, articles, manifests | ✅ | Same Git history |
| D1 mystery photos table | ⚠️ | **Not backed up automatically.** Cloudflare D1 has time-travel (point-in-time recovery within 30 days), but no exported snapshots. |
| D1 comments table | ⚠️ | Same as above |
| Pages secrets | ❌ | Stored only in Cloudflare. Keep the GitHub App `.pem` and admin password in your password manager. |

### Manual D1 export (recommended periodically)

```bash
# Requires wrangler CLI installed and authenticated
wrangler d1 export photoandmoto-community --output photos-backup.sql
```

Run this monthly or before any large schema migration. Store the `.sql` file outside the repo (it contains all base64 image data and could be very large — gigabytes once a real archive accumulates).

### Restoring D1 from time-travel

Cloudflare dashboard → **Workers & Pages** → **D1** → database → **Time travel** → pick a timestamp → **Restore**. Available for 30 days from the point in time. This is your "I just deleted everything" recovery option.

---

## Troubleshooting

### Build fails on Cloudflare

Open the deployment → **Build log**. Common causes:

- **Missing image referenced in an article frontmatter** → the article's `featured_image` path doesn't exist in `src/assets/`
- **Invalid JSON in a gallery manifest** → linter complains about a missing comma or trailing comma in `src/content/galleries/<slug>.json`
- **Sharp action did something unexpected** → check the Action's run log on GitHub
- **Schema mismatch** → an endpoint is querying a column that doesn't exist yet on this environment's D1

### Site loads but mystery endpoints 500

Almost always one of:

- Missing or wrong D1 binding (`DB` variable name, correct database selected)
- Missing or expired GitHub App secret
- Schema not yet bootstrapped — hit `/api/mystery/init` once manually, or just wait for the next mystery endpoint call

Cloudflare Pages → project → **Functions** → **Real-time logs** shows runtime errors with stack traces.

### Publish pipeline fails midway

The pipeline is two steps: (1) Worker commits the original image, (2) GitHub Action generates derivatives.

- **If step 1 fails:** the photo stays in D1, nothing is committed. Safe to retry.
- **If step 1 succeeds but step 2 fails:** the original image is in the repo but no thumb/display/manifest entry. Site won't break (the gallery template handles missing entries) but the photo won't appear. Manual fix: run `npm run generate-gallery <slug> -- --add <filename>` locally and push.
- **If step 2 starts looping** (Action triggers itself): check the loop guard in `process-gallery-image.yml` — it should skip commits whose message matches `chore(gallery): process new image derivatives`. If the message format changed, the guard breaks.

### Cloudflare Pages secret changed but Worker still uses old value

Secrets only refresh on a new build. After updating, go to Deployments → **Retry deployment** on the latest one to force a rebuild.

---

## Backlog and known issues

See the `## Backlog` section at the end of `README.md`. Items relevant to operations:

- **D1 growth monitoring** — no automated alerting yet for table size or row count. Worth adding before any large bulk-import.
- **Original-image archive strategy** — repo will eventually outgrow GitHub's recommended size. R2 / Backblaze / cold storage is a future decision, not urgent.
- **Filename year quirk** — known bug in the publish flow where a typed year can end up as a different value in the resulting filename. Investigate before doing a curated publishing batch.

---

## License

© 2026 Photo & Moto — All rights reserved.
