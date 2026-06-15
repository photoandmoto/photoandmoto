# Decap CMS Migration — archived

> **Archived — migration complete. See [DEPLOYMENT.md](DEPLOYMENT.md) for current setup.**
> (The site has since moved from Decap CMS to **Sveltia CMS**; this document is
> kept only as a record of the original Decap migration.)

**Status: complete.** All three open items below shipped in the second
migration session (June 1, 2026). This document is now a historical record
of what was done and why. For how the system works today, see
`DEPLOYMENT.md` § Content management and `README.md` § Editing content.

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

All items closed in session 2 (June 1, 2026). See `## Completed in session 2`
below.

---

## Completed in session 2

### 1. Wired `/yllapito` to Decap — done

Removed the obsolete `Lähetä artikkeli` and `Hallitse artikkeleita` tabs from
`src/pages/fi/yllapito.astro`. Replaced with a single link-style tab
(`Hallitse artikkeleita ↗`) that opens Decap at `/admin/` in a new window. The
mystery/galleries tabs are untouched, as planned.

Commit: `7a40f15` (plus `9401a67` for an unrelated guard that surfaced during
the cleanup).

### 2. Auto-deletion workflow with guardrails — done

The approach landed simpler than the original plan. Instead of building a
GitHub Action to auto-promote `dev → main` for content edits, we switched
Decap's commit target directly to `main` (`branch: dev` → `branch: main` in
`public/admin/config.yml`). Editor saves go straight to production in ~2
minutes. Decap's built-in preview pane is the review step.

Rationale: the two-step `dev → main` gate exists for code review, where
staging is the smoke-test. For content, Decap already provides a preview
before save, so the gate adds nothing for editors and just adds friction.
Code changes by developers still follow the `dev → PR → main` flow.

Decap's built-in delete-confirmation dialog ("Haluatko varmasti poistaa
tämän julkaistun artikkelin?" once the Finnish locale was added) is the
guardrail against accidental deletes. Recovery for a bad delete is
`git revert <hash>` — ~30 seconds for the developer, faster than any
automated grace-period system would be to operate.

A custom Finnish locale was registered inline in `public/admin/index.html`,
because Decap ships 33 locales and `fi` is not one of them. Covers the full
editor-facing key tree (auth, app, collection, editor, mediaLibrary, ui)
verified against Decap's English source. Missing keys fall back to English.

Commits: `2c6e1a3` (branch switch) and `5e66558` (Finnish locale, correct
structure — the first attempt `34b600d` had the wrong key nesting and was
superseded).

### 3. Cleanup of `functions/api/articles/*` and dead `/yllapito` code — done

Removed in three commits:

- `4cfbc87` — ~1,600 lines of dead `art*` / `hart*` JavaScript from
  `src/pages/fi/yllapito.astro` (article-form handlers, edit mode, markdown
  toolbar, SEO autofill, docx import, preview wiring, review gate, article
  list, filter UI, promote/delete handlers)
- `e79b210` — the entire `functions/api/articles/` folder: `list.js`,
  `get.js`, `delete.js`, `publish.js` (~1,750 lines)
- `c424f7c` — ~300 lines of matching dead CSS (`.art-*` and `.hart-*` rules)

`functions/api/mystery/publish.js` is unaffected — that one backs the
`Julkaise Galleriaan` button for mystery photos and is unrelated to articles.

Total net cleanup: ~3,500 lines of dead code removed, ~260 lines of Finnish
locale added.

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
