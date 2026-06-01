# Decap CMS Migration

Record of the migration from the custom article admin to Decap CMS — what
shipped, what was deliberately skipped, and what's still open.

For how the system works **today**, see `DEPLOYMENT.md` § Content management.
This document is the migration history; once the remaining items are done it
becomes an archive.

---

## Why

The article half of the custom `/yllapito` admin (the `Lähetä artikkeli` /
`Hallitse artikkeleita` flow, `functions/api/articles/*`, the `[[image:N]]`
placeholder system, EN auto-stub generation) was buggy and premature. It was
replaced with **Decap CMS** — a boring, reliable git-based editor.

**Scope boundary:** only the *article* half was replaced. Mystery photos and
galleries stay on the custom `/yllapito` admin, unchanged.

---

## Shipped — live in production

### Step 1 — Decap foundation

- Decap CMS served from `public/admin/`, reachable at `/admin/`
- GitHub OAuth login — a GitHub OAuth App (separate from the publish-pipeline
  GitHub App) plus an OAuth proxy in `functions/oauth/{auth,callback}.js`
- Bilingual articles via `i18n: multiple_folders` — one entry, FI + EN tabs,
  shared slug, files at `src/content/articles/{fi,en}/<slug>.md`
- `publish_mode: simple` — Decap commits straight to `dev`, no editorial workflow
- Schema (`src/content.config.ts`) hardened for Decap's output:
  - optional strings → `.nullish()` (Decap writes `null`, not omission)
  - booleans → `z.preprocess()` to coerce `null` → default
  - `language` made optional; the 6 article-rendering pages refactored from
    `data.language === 'xx'` filters to path-based (`entry.id.startsWith`)
  - `ArticleLayout` takes a `lang` prop instead of reading `frontmatter.language`

### Step 1 extensions

- **Categories collection** — data-driven (`src/content/categories/*.json`);
  the article `category` field is a `relation` widget. Editors add categories
  from the Decap UI without a code change.
- **Image auto-compression** — `compress-article-images.yml` + Sharp; resizes
  oversized `public/images/` files on push.
- **Lähetä/Sources field** — optional `sources` field, rendered as a styled
  block with auto-linked URLs at the end of articles.
- **Branded Decap UI** — Photo & Moto colours, Montserrat (`branding.css`).
- **Custom preview** — `preview.js` renders an article-shaped preview matching
  `ArticleLayout.astro`, with locale-aware labels.
- **Live SEO health panel** — 8 checks (title/description length, image,
  caption, tags, word count, H2 count) shown in the preview pane.
- **View filters / groups** on the article list (drafts, untranslated;
  by category, by year).
- `Luonnos` toggle relabelled `Piilota sivustolta` to remove a double-negative.
- Slug normalization (`encoding: ascii`, `clean_accents: true`) so Finnish
  titles produce ASCII filenames.

### Step 3 — Gemini auto-translation

- `translate-article.yml` Action + `scripts/translate-article.mjs`
- Uses **gemini-2.5-flash** (`thinkingBudget: 0`, JSON-schema output)
- Opt-in per article via the `auto_translated` toggle: `true` → translate on
  push; missing/`false` → skip (protects human-reviewed translations)
- `scripts/translation-glossary.md` holds site-specific term overrides

### Editorial tooling

- **Quick Add templates** — `+ Uusi MXGP-juttu`, `+ Uusi historiallinen
  tarina` shadow collections with pre-filled category, tags, body skeleton
- **Link checker** — `check-links.yml` scans article markdown for dead links
- **OG image generation** — `generate-og-images.yml` + Sharp + `text-to-svg` +
  `@fontsource/montserrat`; per-article 1200×630 branded social cards in
  `public/og/`, wired into `og:image` via `ArticleLayout`

### Documentation

- `DEPLOYMENT.md`, `README.md`, `src/assets/galleries/README.md` rewritten for
  the Decap architecture

---

## Skipped — deliberate decisions

### Step 2 — Astro fallback page for missing EN articles

**Declined.** The original plan included a "translation in progress" fallback
page for FI articles with no EN counterpart. But with `i18n: multiple_folders`,
Decap always writes both locale files on save — an FI-only state doesn't occur
in normal use. The fallback would have been dead code. Skipped.

---

## Open — still to do

1. **Wire `/yllapito` to Decap.** Remove the obsolete `Lähetä artikkeli` and
   `Hallitse artikkeleita` tabs from `src/pages/fi/yllapito.astro` (article CRUD
   is Decap's job now). Add a `Hallitse artikkeleita` entry that links to
   `/admin/`. Leave the mystery/galleries tabs untouched.

2. **Auto-deletion workflow with guardrails.** Decap article/category deletes
   currently reach `dev`/staging only; production needs a manual `dev → main`
   promote. Build a guarded auto-promotion so deletes propagate to production
   safely (confirmation step or delayed PR auto-merge). Applies to both article
   and category deletions.

3. **Cleanup of `functions/api/articles/*`.** `list.js`, `get.js`, `delete.js`
   are unused now that Decap owns article CRUD (~600 lines). `publish.js` stays
   — its `mode=production` path still backs the `/yllapito` promote button.
   Remove the three dead files once #1 is done.

---

## Operational gotchas discovered during the migration

- **Decap writes `null`** for empty optional fields rather than omitting them —
  hence the `.nullish()` / `z.preprocess()` schema changes.
- **Boolean widgets need `required: false`** even with a `default:`, or Decap
  blocks publish demanding the field be touched.
- **`draft: true` silent un-publish** — if the `Piilota sivustolta` toggle is
  on, Astro drops the article from `getStaticPaths()`, no page is built, and
  Cloudflare keeps serving the stale cached page. No error. Verify a save with
  `git show origin/dev:src/content/articles/<lang>/<slug>.md`.
- **localStorage caching** — Decap caches pending edits per browser; cold-load
  testing requires clearing it.
- **`/admin/` vs `/admin/index.html`** — Astro dev doesn't auto-resolve the
  directory index; use `/admin/index.html` locally. Production is fine.
- **gemini-2.5-pro can't disable thinking** — it requires thinking mode, which
  consumed the output budget and truncated translations. Switched to
  gemini-2.5-flash with `thinkingBudget: 0`.
