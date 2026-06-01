# Photo & Moto

Motorsport history site — motocross, speedway, and enduro photography and
stories from the 1960s to today. Bilingual (Finnish primary, English
secondary), built with [Astro](https://astro.build) and deployed on
[Cloudflare Pages](https://pages.cloudflare.com).

**Live:** [www.photoandmoto.fi](https://www.photoandmoto.fi)

For deployment, environment setup, secrets, and operations, see
**[DEPLOYMENT.md](DEPLOYMENT.md)**.

---

## Quick start

```bash
npm install
npm run dev        # → http://localhost:4321
npm run build      # production build
npm run preview    # preview the build locally
```

Node.js 20+ required.

To test the Decap CMS locally (no GitHub OAuth needed):

```bash
npx decap-server   # second terminal
# then open http://localhost:4321/admin/index.html
```

---

## What's on the site

Bilingual public site (`/fi/...` and `/en/...`):

- **Etusivu / Home** — landing page; includes the community "APUA TARVITAAN" help block
- **Galleria / Gallery** — curated photo collections, PhotoSwipe lightbox
- **Aikakone / Time Machine** — long-form articles
- **Kalenteri** — race calendar
- **Tilastot** — stats pages (FIM World Champions, SM, Motocross des Nations, AMA, Trans-AMA)
- **MXGP 2026** — current season tracker
- **Podcast** — episodes
- **Tunnista kuva** — community mystery-photo identification

---

## Editing content

The site has **two separate admin systems**, by deliberate design.

### Articles — Decap CMS at `/admin/`

Articles (the Aikakone content) are edited in **Decap CMS**, a git-based CMS
served from `public/admin/`.

- **URL:** `https://www.photoandmoto.fi/admin/` — login with GitHub
- Commits go directly to the `main` branch — editor saves auto-deploy to
  production in ~2 minutes. Decap's built-in preview pane is the review step;
  there is no manual `dev → main` promote for content edits.
- Bilingual: one entry, FI + EN tabs, written to
  `src/content/articles/{fi,en}/<slug>.md`
- **Quick Add templates** for MXGP and historical articles, with pre-filled
  category, tags, and a body skeleton
- A **Gemini-powered GitHub Action** auto-translates Finnish articles to
  English when an article is flagged `auto_translated: true`
- Article frontmatter reference and the full workflow are in
  [DEPLOYMENT.md § Content management](DEPLOYMENT.md)

### Mystery photos + galleries — `/fi/yllapito`

The community photo-identification flow and gallery management run in the
original custom admin.

- **URL:** `https://www.photoandmoto.fi/fi/yllapito` — personal-account login
  (email + password, see [Authentication & access control](#authentication--access-control) below)
- Backed by `functions/api/mystery/*` and Cloudflare D1

---

## Authentication & access control

The custom admin (`/fi/yllapito`) is gated by a per-user IAM system. Decap
CMS at `/admin/` uses GitHub OAuth and is independent.

- **Login:** email + password at `/fi/yllapito`, returns a 30-day session cookie
- **Password recovery:** 3 security questions (2 of 3 correct to reset),
  at `/fi/palauta-salasana`
- **5 per-user permission flags** control which yllapito tabs render:
  `tarkista`, `lahetakuva`, `hallitse_galleriaa`, `hallitse_artikkeleita`,
  `admin_iam`. A user can have any combination; role (Editor/Admin) is
  cosmetic
- **Provisioning:** new users are created from the Käyttäjät tab (requires
  `admin_iam`) and activate via a one-time, 7-day link to `/fi/aseta-salasana`
- **Audit:** the Käyttäjät tab includes a recovery-attempt log (last 50
  attempts, success/fail, IP, timestamp)
- Backend lives in `functions/api/auth/*`; auth lib + schema bootstrap in
  `functions/_lib/auth.js` and `functions/api/auth/init.js`

The full design rationale is in [IAM_DESIGN.md](IAM_DESIGN.md). The
user-facing manual section is in [JULKAISIJAN_OHJEET.md](JULKAISIJAN_OHJEET.md)
§ Käyttäjätilit ja oikeudet. Operational details (env vars, seed flow,
backup) are in [DEPLOYMENT.md](DEPLOYMENT.md).

Mystery endpoints still accept a legacy `UPLOAD_PASSWORD` as a dual-mode
fallback during the rollout window. This will be removed in a follow-up
commit once IAM has been stable in production for 24–48h.

---

## Tunnista kuva — community mystery-photo identification

A two-sided feature: the public helps identify old motorsport photos, and the
admin curates the results.

### Public side

- Visitors browse mystery photos at `/fi/tunnistamatta`
- They suggest **per-field information** — year, people, location, plus free
  text — and comment on / upvote existing suggestions
- Once a photo is fully identified, it leaves the public mystery list
- The landing pages show an **"APUA TARVITAAN / HELP NEEDED" block** with up to
  6 random unidentified photos; it hides itself when none exist

### Admin side (`/fi/yllapito`)

- **Tarkista** — review suggestions, write canonical metadata per field; photo
  status auto-promotes (Uusi → Osittain tunnistettu → Tunnistettu)
- **Lähetä kuva** — upload new mystery photos; the browser generates a small
  thumbnail at upload time for the landing-page block
- **Hallitse galleriaa** — caption edits, move/delete photos, rename galleries
- One-click **Julkaise Galleriaan** moves an identified photo into a permanent
  gallery (see the pipeline below)

### Storage

- **Cloudflare D1** — photos table (incl. `thumb_data`) + comments table
- **GitHub repo** — `public/galleries/<slug>/` holds the image files; manifests
  live in `src/content/galleries/<slug>.json`

---

## Gallery publishing pipeline

When an admin clicks **Julkaise Galleriaan** on an identified mystery photo:

```
Admin clicks Julkaise
    ↓
functions/api/mystery/publish.js Worker:
  - Authenticates as the GitHub App "Photoandmoto Publisher"
  - Reads photo metadata from D1, builds the filename
  - Atomic GitHub commit: adds the image to public/galleries/<slug>/
  - Deletes the photo row + comments from D1
    ↓
.github/workflows/process-gallery-image.yml triggers
    ↓
scripts/generate-gallery-manifest.mjs --add <filename>:
  - 600px thumbnail (no watermark)
  - 1400px display version (© Photo & Moto watermark)
  - Updates src/content/galleries/<slug>.json
    ↓
Bot commits derivatives → Cloudflare deploys → photo appears in the gallery
```

~2 minutes, zero manual steps. The Action skips its own derivative commits via
a commit-message loop guard.

---

## Adding a gallery manually (bulk import)

```bash
# 1. Drop photos into the gallery folder
mkdir -p public/galleries/my-gallery
cp ~/photos/*.jpg public/galleries/my-gallery/

# 2. Generate thumbnails, display versions, and the manifest
npm run generate-gallery my-gallery

# 3. Preview, then deploy
npm run dev          # → http://localhost:4321/fi/galleria/my-gallery
git add . && git commit -m "Add my-gallery" && git push
```

`scripts/generate-gallery-manifest.mjs` has two modes:

| Mode | Command | Use case |
|---|---|---|
| Full rebuild | `npm run generate-gallery <slug>` | Bulk-import a folder of photos |
| Incremental | `npm run generate-gallery <slug> -- --add <file>` | One photo (used by the publish Action) |

Gallery categories (`international`, `finland`, `enduro`, `scramble`,
`black-white`) are derived from the slug. Current galleries: `international-70s`,
`international-80s`, `international-90s`, `suomi-70s`, `suomi-80s`, `suomi-90s`,
`hyvinkaa-scramble`. Detailed photo-adding notes are in
[src/assets/galleries/README.md](src/assets/galleries/README.md).

---

## GitHub Actions

All workflows are in `.github/workflows/` and documented in
[DEPLOYMENT.md § GitHub Actions reference](DEPLOYMENT.md):

| Workflow | Purpose |
|---|---|
| `translate-article.yml` | Gemini FI → EN article translation |
| `compress-article-images.yml` | Resize/re-encode oversized article images |
| `generate-og-images.yml` | Per-article 1200×630 branded social cards |
| `check-links.yml` | Scan article markdown for broken external links |
| `process-gallery-image.yml` | Gallery thumbnail/display derivative generation |
| `mxgp-scraper.yml` | Refresh MXGP results data |

---

## Project structure

```
.github/workflows/      GitHub Actions
functions/
  api/mystery/          Mystery-photo + gallery endpoints, D1-backed
  oauth/                GitHub OAuth proxy for Decap login
public/
  admin/                Decap CMS — config.yml, preview.js, branding.css
  images/               Article images
  galleries/<slug>/     Gallery images + generated thumbs/ and display/
  og/                   Auto-generated social cards
  data/site-index.json  Generated search index (build artifact)
scripts/
  generate-gallery-manifest.mjs   Sharp pipeline + gallery manifest
  generate-site-index.mjs         Search index builder
  generate-llms.mjs               llms.txt generator
  translate-article.mjs           Gemini translation
  generate-og-image.mjs           OG card compositor
  check-links.mjs                 Link checker
  compress-article-images.mjs     Image compressor
  translation-glossary.md         Terms Gemini must not translate
src/
  content/
    articles/{fi,en}/   Markdown articles
    galleries/          Gallery manifests (JSON)
    categories/         Article categories (JSON)
  content.config.ts     Content collection schemas (Zod)
  pages/                Routes — split fi/ and en/
    fi/yllapito.astro   Custom admin (mystery photos + galleries)
  layouts/              BaseLayout, ArticleLayout
  components/           Shared components
  i18n/                 UI translations
  styles/               brand.css, global.css, components.css
astro.config.mjs
DEPLOYMENT.md           Deployment + operations guide
```

---

## Tech stack

- **Framework:** Astro 6 (static output), TypeScript strict mode
- **Content:** Astro content collections, Zod-validated
- **CMS:** Decap CMS (git-based) for articles
- **Gallery viewer:** PhotoSwipe 5
- **Image processing:** Sharp (libvips)
- **Search:** Pagefind (static index)
- **Server-side:** Cloudflare Pages Functions (Workers runtime)
- **Database:** Cloudflare D1 (edge SQLite) — mystery photos + comments
- **Auth:** GitHub OAuth (Decap login); GitHub App + in-Worker JWT (publish pipeline)
- **CI/CD:** GitHub Actions + Cloudflare Pages auto-deploy
- **Languages:** Finnish (`fi`), English (`en`)

---

## Deployment

Automatic via Cloudflare Pages. Two environments:

| Branch | Cloudflare project | URL | D1 database |
|---|---|---|---|
| `main` | photoandmoto | www.photoandmoto.fi | photoandmoto-community |
| `dev` | photoandmoto-staging | photoandmoto-staging.pages.dev | photoandmoto-community-dev |

Working rule: changes go to `dev` first → verified on staging → PR `dev → main`
promotes to production. Full setup, secrets, and troubleshooting are in
[DEPLOYMENT.md](DEPLOYMENT.md).

### D1 schema

`functions/api/mystery/init.js` bootstraps the schema idempotently on first
request. Reference:

```sql
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  content_type TEXT DEFAULT 'image/jpeg',
  image_data TEXT NOT NULL,            -- base64-encoded image bytes
  uploader_name TEXT NOT NULL,
  year_estimate TEXT DEFAULT '',
  people TEXT DEFAULT '',
  location_notes TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'new',           -- 'new' | 'partial' | 'identified'
  created_at TEXT DEFAULT (datetime('now')),
  published_to_gallery_at TEXT DEFAULT NULL,
  thumb_data TEXT DEFAULT NULL         -- base64 JPEG for landing-page block
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id INTEGER NOT NULL,
  parent_id INTEGER,
  author_name TEXT,
  content TEXT NOT NULL,
  field_type TEXT,                     -- 'year' | 'people' | 'location' | 'notes' | 'general'
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (photo_id) REFERENCES photos(id)
);

CREATE INDEX IF NOT EXISTS idx_comments_photo ON comments(photo_id);
CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
```

---

## SEO and structured data

Full structured-data SEO is baked into the layouts — new articles and galleries
pick it up automatically, no per-page work.

Every page gets: per-page title + meta description, canonical URL, hreflang
`fi`/`en`/`x-default` alternates, Open Graph + Twitter tags, JSON-LD
Organization + WebSite schema, GA4 (`G-9Y0PEJY0XG`).

Article pages additionally get JSON-LD Article schema and use the
auto-generated OG card (`public/og/<slug>-<lang>.jpg`) as `og:image`.

Sitemap (`sitemap-index.xml`) is generated each build by `@astrojs/sitemap`
with hreflang alternates. `public/robots.txt` points to it; `public/_redirects`
handles `/` → `/fi`.

---

## Backlog

Tracked work that's not blocking but worth picking up in future sessions.
Listed in rough priority order.

### Phase D — Admin gallery management

The existing `Hallitse galleriaa` tab covers caption edits, moves, deletes,
and rename. Still missing: photo reordering within a gallery, deleting an
entire gallery. Estimated: half a session.

### Phase E — Storage and cost ops

The current model commits original-resolution images to the GitHub repo. Fine
at the current scale (~600 photos), but will become awkward as the archive
grows past ~3 GB. Followups:

- Decide on an original-image archive strategy (Cloudflare R2? Backblaze B2?
  offline cold storage?) once repo size becomes a concern
- Add basic D1 growth monitoring (count rows, total bytes per table) — useful
  before any large bulk-imports
- One-shot cleanup endpoint to remove old `field_type='general'` rows in
  `comments` (legacy data from before per-field suggestions)

### Generated `site-index.json` shows as modified on every checkout

`public/data/site-index.json` is a build artifact (regenerated by
`scripts/generate-site-index.mjs`) but committed to the repo. Every
`git checkout` between branches shows it as locally modified, which is noisy
and occasionally causes confusion. Two options: add to `.gitignore` (relies
on Cloudflare regenerating on every build) or move it to a `dist`-only path.
Low priority — just clutter.

---

## License

© 2026 Photo & Moto — All rights reserved.
