# Photo & Moto

Motocross and motorcycle sport photography, stories and race results from the 1960s to today. European editorial style, orange-on-black brand.

**Live:** [www.photoandmoto.fi](https://www.photoandmoto.fi)

## Tech Stack

- **Framework:** Astro 4.16 (static output)
- **Hosting:** Cloudflare Pages (CNAME from photoandmoto.fi)
- **Gallery:** PhotoSwipe lightbox
- **Image Processing:** Sharp
- **Languages:** Finnish (primary), English
- **Analytics:** GA4 + Cloudflare Web Analytics

## Quick Start

```bash
npm install
npm run dev        # → http://localhost:4321
npm run build      # Production build
```

## Content

### Articles

Markdown files in `src/content/articles/fi/`. Frontmatter fields: `title`, `subtitle`, `date`, `category`, `tags`, `featured_image`, `card_image` (optional hero override), `language`.

Categories: MXGP, MX2, Historical, Speedway, Enduro, Technical, Interview.

### Galleries

Seven photo galleries with JSON manifests in `src/content/galleries/`. Photos served from `public/galleries/` with display and thumb variants.

### Calendar

`public/data/calendar.json` — race events with `date`, `title`, `location`, `description`, `category`. Categories: MXGP, MotoGP, AMA, SM, SML, Motocross, Enduro, Trial, Muu.

### Podcast

Four episodes with archive cover photos, wired directly in the homepage components.

### Statistics

FIM World Champions, Suomen mestarit, Motocross des Nations, AMA Champions, Trans-AMA Champions.

## Homepage Architecture

Both FI and EN homepages share the same layout pattern:

- **TrendingTicker** — auto-rotating article headlines (FI only)
- **Header** — sticky, hamburger <768px, pure wordmark
- **Hero band** — subdued tagline, white/gray text
- **Uusimmat artikkelit** — 1 big + 2 stacked + 4 secondary row (FI only)
- **Tulevat kilpailut** — next 5 rolling races from calendar.json
- **Galleria** — rotating 1+3 split with crossfade
- **Podcast** — rotating 1+3 split with archive photos
- **Ota yhteyttä / Contact** — 3 CTA cards → yhteystiedot
- **Footer**

## Key Components

| Component | Purpose |
|---|---|
| `Header.astro` | Sticky nav, hamburger mobile, "Muuta" dropdown |
| `TrendingTicker.astro` | Auto-rotate headlines, pause on hover |
| `ArticleCard.astro` | Reusable card (lg/md/sm), category chip |
| `RotatingHeroSplit.astro` | 1 big + 3 stacked, 10s crossfade rotation |
| `UpcomingRaces.astro` | Next 5 races, supports `lang` prop (fi/en) |

## Project Structure

```
photoandmoto/
├── src/
│   ├── components/       # Reusable Astro components
│   ├── content/          # Content collections (articles, galleries)
│   ├── i18n/             # Translations (ui.ts)
│   ├── layouts/          # BaseLayout, ArticleLayout
│   ├── pages/
│   │   ├── fi/           # Finnish pages (primary)
│   │   └── en/           # English pages
│   └── styles/           # global.css, brand.css, components.css
├── public/
│   ├── data/             # calendar.json, mxgp-results.json, site-index.json
│   ├── galleries/        # Photo files (display + thumb)
│   └── images/           # Article hero images
├── scripts/              # generate-site-index.mjs, MXGP scraper
└── functions/            # Cloudflare Functions (AI search)
```

## Git Workflow

```bash
git add .
git commit -m "Description"
git pull --rebase          # MXGP bot may have committed
git push
```

**MXGP Bot** auto-commits to main (Sun 20:00 UTC + Mon 06:00 UTC) — always rebase before push.

## Deployment

Push to `main` → Cloudflare Pages auto-deploys. Build time ~15–35s, 38 pages.

## SEO

- Canonical URLs, hreflang (fi↔en), x-default
- OG and Twitter cards on all pages
- `@astrojs/sitemap` (v3.2.1)
- robots.txt
- Google Search Console verified

## Domain Setup

- **Primary:** www.photoandmoto.fi → CNAME to photoandmoto.pages.dev
- **Nameservers:** euronic.fi (handles email)
- **Legacy:** digiai.fi redirects (Domainkeskus 185.55.85.12)

## License

© 2026 Photo & Moto — All rights reserved.
