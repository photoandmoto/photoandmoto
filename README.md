# Photo & Moto Website

Modern static site for motorsport history photos and stories. Built with [Astro 4.5](https://astro.build), deployed on [Cloudflare Pages](https://pages.cloudflare.com), with a small set of Cloudflare Pages Functions for the community-curation features (mystery-photo identification, comments, voting, admin tooling, gallery publishing).

**Live:** [www.photoandmoto.fi](https://www.photoandmoto.fi)

---

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev
# → http://localhost:4321

# Build for production
npm run build

# Preview production build
npm run preview
```

Node.js 20+ required.

---

## What's in the site

The public site is bilingual (Finnish primary, English secondary):

- **Etusivu** — landing page with featured content
- **Galleria** — curated photo collections (categories: Suomi, International, Scramble, Enduro, Black & White)
- **Aikakone** — long-form articles
- **Kalenteri** — race calendar
- **Tilastot** — stats pages (FIM World Champions, SM, Motocross des Nations, AMA, Trans-AMA)
- **MXGP 2026** — current MXGP season tracker
- **Podcast** — episodes
- **Tunnista kuva** — community-driven mystery photo identification (see below)

Each gallery uses [PhotoSwipe](https://photoswipe.com) for the lightbox experience.

---

## Tunnista kuva — community mystery-photo identification

A two-sided feature where the public helps identify old motorsport photos and admin curates the results.

### Public side

- Visitors browse mystery photos at `/fi/tunnistamatta`
- They can suggest **per-field information**: year, people, location, plus a free-text "muu tieto"
- They can comment on existing suggestions and upvote/downvote them
- Once a photo is fully identified by admin, it disappears from the public mystery list

### Admin side

- Admin login (password-protected) reveals additional UI on the same page
- **Tarkista tab**: review suggestions, write canonical metadata per field, save → photo status auto-promotes (Uusi → Osittain tunnistettu → Tunnistettu)
- **Lähetä kuva tab**: upload new mystery photos with optional partial metadata
- Filters show what's new since last login (`Tarkistettavaa`, `Kesken`, `Valmiit`)
- One-click **Julkaise Galleriaan** moves a fully-identified photo into the permanent gallery (see "Publishing pipeline" below)

### Storage

- **Cloudflare D1** (SQLite at the edge): photos table + comments table
- **GitHub repo** (`public/galleries/<slug>/`): the actual image files for each gallery, plus the manifest in `src/content/galleries/<slug>.json`

---

## Publishing pipeline (admin-only)

When an admin clicks **Julkaise Galleriaan** on an identified mystery photo, this happens automatically:

```
Admin clicks Julkaise
    ↓
publish.js Worker:
  - Authenticates as the GitHub App "Photoandmoto Publisher"
  - Reads photo metadata from D1
  - Builds filename from: <people> <location> <year>.jpg
  - Atomic GitHub commit to the current branch (dev or main):
      • adds image to public/galleries/<slug>/
      • optionally creates manifest stub for new gallery
  - Deletes photo row + comments from D1
    ↓
.github/workflows/process-gallery-image.yml triggers on the commit
    ↓
generate-gallery-manifest.mjs --add <filename>:
  - Generates 600px thumbnail (no watermark)
  - Generates 1400px display version (with © Photo & Moto watermark)
  - Updates src/content/galleries/<slug>.json (sorted by year)
    ↓
Bot commits derivatives back to the branch
    ↓
Cloudflare Pages auto-deploys → photo appears in the gallery
```

The whole thing takes ~2 minutes and requires zero manual steps. Loop guard: the Action skips its own derivative commits by checking commit message (`chore(gallery): process new image derivatives`), so it doesn't trigger itself.

### What admin can do

- Pick an **existing gallery** from the dropdown (auto-discovered from the repo, refreshed every 60s)
- Or pick **➕ Luo uusi galleria…** and the new gallery is created on the fly
- Edit the auto-composed caption before publishing
- See a live filename preview

---

## Adding content manually (when you don't need the publish flow)

### Add a new gallery (manual / bulk import)

```bash
# 1. Drop photos into the gallery folder
mkdir -p public/galleries/my-gallery
cp ~/photos/*.jpg public/galleries/my-gallery/

# 2. Generate thumbnails, display versions, and manifest
npm run generate-gallery my-gallery

# 3. Preview
npm run dev
# → http://localhost:4321/fi/galleria/my-gallery

# 4. Deploy
git add .
git commit -m "Add my-gallery"
git push
```

The script (`scripts/generate-gallery-manifest.mjs`) supports two modes:

| Mode | Command | Use case |
|---|---|---|
| Full rebuild | `npm run generate-gallery <slug>` | Bulk-import a folder of photos |
| Incremental | `npm run generate-gallery <slug> -- --add <filename>` | Process a single photo (used by the publish pipeline's GitHub Action) |

### Add a new article

```bash
# 1. Create markdown file
touch src/content/articles/fi/my-article.md

# 2. Frontmatter + content
---
title: "Article Title"
subtitle: "Subtitle"
date: 2026-04-25
category: "MXGP"
tags: ["motocross", "racing"]
featured_image: "/src/assets/articles/my-article/hero.jpg"
language: "fi"
---

Article body...

# 3. Images
mkdir -p src/assets/articles/my-article
cp ~/hero.jpg src/assets/articles/my-article/

# 4. Preview + deploy
npm run dev
git add . && git commit -m "Add article" && git push
```

---

## Project Structure

```
photoandmoto/
├── .github/
│   └── workflows/
│       ├── process-gallery-image.yml    # Sharp processing on push to galleries/
│       └── ...                          # MXGP scraper, etc
├── functions/                           # Cloudflare Pages Functions (server-side)
│   └── api/mystery/
│       ├── photos.js                    # GET — list photos
│       ├── upload.js                    # POST — admin uploads new mystery photo
│       ├── comment.js                   # POST — community suggestion / reply
│       ├── vote.js                      # POST — upvote / downvote
│       ├── admin.js                     # POST — admin actions (update_meta, delete_*, etc)
│       ├── verify.js                    # POST — admin login
│       ├── init.js                      # POST — schema bootstrap (idempotent)
│       ├── galleries.js                 # GET — gallery dropdown list (auto-discovered)
│       └── publish.js                   # POST — Julkaise Galleriaan flow
├── public/
│   ├── galleries/<slug>/                # Original images
│   ├── galleries/<slug>/thumbs/         # 600px thumbs
│   ├── galleries/<slug>/display/        # 1400px display + watermark
│   └── data/site-index.json             # Generated build artifact
├── scripts/
│   ├── generate-gallery-manifest.mjs    # Sharp + manifest generator (full + --add)
│   ├── generate-site-index.mjs          # Search index builder
│   └── ...
├── src/
│   ├── assets/                          # Astro-processed images (articles, site)
│   ├── components/                      # Reusable .astro components
│   ├── content/
│   │   ├── articles/                    # Markdown articles
│   │   └── galleries/<slug>.json        # Gallery manifests
│   ├── i18n/                            # Translations (fi, en)
│   ├── layouts/                         # Page layouts
│   ├── pages/                           # Routes — split fi/ and en/
│   ├── styles/                          # Global CSS
│   └── utils/                           # Helpers
├── DEPLOYMENT.md                        # Deployment + secrets reference
├── astro.config.mjs
└── package.json
```

---

## Deployment

Automatic via Cloudflare Pages.

| Branch | Cloudflare Project | URL | D1 Database |
|---|---|---|---|
| `main` | photoandmoto | www.photoandmoto.fi | photoandmoto-community |
| `dev`  | photoandmoto-staging | photoandmoto-staging.pages.dev | photoandmoto-community-dev |

Pushes to either branch trigger an auto-build. The publish pipeline's Worker auto-detects which branch it's running on (via `CF_PAGES_BRANCH`) and commits to the matching one — so a publish on staging stays on staging.

### Required secrets (per Pages project)

- `UPLOAD_PASSWORD` — admin login for Tunnista kuva
- `GEMINI_API_KEY` — for the AI-suggestion fallback (optional)
- `GITHUB_APP_ID` — Photoandmoto Publisher app
- `GITHUB_APP_INSTALLATION_ID` — installation on the photoandmoto repo
- `GITHUB_APP_PRIVATE_KEY` — full PEM contents of the App's private key

### D1 schema

`functions/api/mystery/init.js` is idempotent — first request to any mystery endpoint will run schema migrations. Manual reference:

```sql
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  image_url TEXT NOT NULL,
  status TEXT DEFAULT 'new',           -- 'new' | 'partial' | 'identified'
  year_estimate TEXT,
  people TEXT,
  location_notes TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  published_to_gallery_at TEXT DEFAULT NULL
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

## Tech Stack

- **Framework**: Astro 4.5 (static output)
- **Gallery viewer**: PhotoSwipe 5.4
- **Image processing**: Sharp (libvips) — thumbnails, display, watermark
- **Server-side**: Cloudflare Pages Functions (Workers runtime)
- **Database**: Cloudflare D1 (edge SQLite)
- **Storage**: GitHub repo as the canonical image store
- **CI**: GitHub Actions (Sharp pipeline) + Cloudflare auto-deploy
- **Auth (publish pipeline)**: GitHub App + JWT signed in-Worker via Web Crypto
- **Languages**: Finnish (`fi`), English (`en`)

---

## Development

- Node.js 20+
- `npm run dev` — localhost:4321 with hot reload
- TypeScript strict mode
- Astro content collections (zod-validated)
- Cloudflare Pages Functions can be tested locally with `wrangler pages dev` (separate workflow, optional)

---

## License

© 2026 Photo & Moto — All rights reserved.
