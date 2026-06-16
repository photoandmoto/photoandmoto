# Yleinen Kynä — Community Article Submission

**Photo & Moto — Concept Design v2.0**
**Status: Phase 1 complete and accepted on staging (dev). Pending promotion to production. Phase 2 planned.**

---

## Purpose

Enable community members — photographers, racers, fans — to submit articles and
photos directly to photoandmoto.fi through a structured Finnish-language form,
without requiring CMS access. All submissions go through editorial review before
publication.

---

## Name & Entry Point

**Yleinen Kynä** (The Community Pen) — a dedicated page accessible from the
**Muuta** dropdown in the main navigation.

- **URL:** `www.photoandmoto.fi/fi/yleinen-kyna`
- **Nav item:** Muuta → Yleinen Kynä ✍

---

## User Roles

| Role | Access | IAM flag |
|---|---|---|
| admin | All Ylläpito tabs + user management | `perm_admin_iam` |
| editor | Tarkista, Lähetä kuva, Hallitse galleriaa, Hallitse artikkeleita, Julkaise | `perm_hallitse_artikkeleita` |
| contributor | Yleinen Kynä submission form only | `perm_laheta_artikkeli` (new) |

---

## Page Flow

### First visit — no account

1. Visitor clicks **Yleinen Kynä** in the Muuta dropdown
2. Page shows two options:
   - **Kirjaudu sisään** — has credentials → login form → submission form
   - **Pyydä käyttöoikeutta** — no account yet → fills name + email → request sent
3. Access request email fires to `photoandmoto@gmail.com`
4. Editor reviews request → creates account in Käyttäjät tab → sends provisioning link
5. Contributor activates account at `/fi/aseta-salasana` → sets password

### Returning contributor — has account

1. Clicks **Yleinen Kynä** → **Kirjaudu sisään**
2. Logs in with email + password
3. Lands directly on the Finnish submission form
4. Fills in form → uploads photos → clicks **Lähetä artikkeli**
5. System commits draft to GitHub, uploads photos to R2
6. Editor receives email notification

### Editor flow

1. Receives email: "Uusi artikkeli odottaa tarkistusta — [title]"
2. Opens Sveltia at `photoandmoto.fi/admin/`
3. Finds draft article (`draft: true`, Piilota sivustolta ON)
4. Reviews content, edits if needed
5. Fills in `seo_description` (not exposed to contributor)
6. Decides whether to enable EN locale and translate via Gemini
7. Toggles Piilota sivustolta OFF
8. Saves in Sveltia → commits to dev
9. Julkaise esikatseluun → preview on staging
10. Julkaise tuotantoon → article live on production

---

## Email Notifications

### Access request → editor

```
From: noreply@photoandmoto.fi
To: photoandmoto@gmail.com
Subject: Uusi käyttöoikeuspyyntö — Yleinen Kynä

Nimi: [name]
Sähköposti: [email]
Lähetetty: [timestamp]

Luo käyttäjätili: https://www.photoandmoto.fi/fi/yllapito
```

### New submission → editor

```
From: noreply@photoandmoto.fi
To: photoandmoto@gmail.com
Subject: Uusi artikkeli odottaa tarkistusta — [title]

Otsikko: [title]
Lähettäjä: [contributor first name last name]
Kategoria: [category]
Lähetetty: [timestamp]

Avaa Sveltia: https://www.photoandmoto.fi/admin/
```

---

## Submission Form Fields

| Form field (Finnish UI) | Frontmatter key | Required | Notes |
|---|---|---|---|
| Otsikko | `title` | ✅ | Min 5 chars |
| Alaotsikko | `subtitle` | ❌ | Optional |
| Kirjoittaja | `author` | auto | Auto-filled from IAM name — contributor cannot change |
| Päivämäärä | `date` | auto | Auto-set to submission date |
| Kategoria | `category` | ✅ | Dropdown from categories collection |
| Avainsanat | `tags` | ❌ | Comma-separated input |
| Pääkuva | `featured_image` | ✅ | Upload → R2 → `/images/<file>` path |
| Korttikuva | `card_image` | ❌ | Optional — hero used as fallback on cards |
| Pääkuvan kuvateksti | `image_caption` | ❌ | Optional |
| Lisäkuvat (body) | embedded in body | ❌ | Multiple uploads → R2 → markdown image syntax |
| Sisältö | `body` | ✅ | Markdown textarea |
| Lähteet | `sources` | ❌ | One per line, URLs auto-link |
| — | `draft` | auto | Always `true` — editor controls publication |
| — | `seo_description` | editor only | Not shown to contributor — editor fills before publishing |
| — | `show_hero` | auto | Always `true` |

---

## Single Source of Truth

`src/content.config.ts` is the canonical field schema. All writers must produce
frontmatter that passes Zod validation at build time:

```
src/content.config.ts  (Zod schema — canonical truth)
         ↓ enforces
src/content/articles/fi/*.md
         ↑ written by           ↑ written by            ↑ written by
     Sveltia CMS          submit-article.js         future automation
         ↑ read by
     Astro build
```

A build failure = a writer drifted from the schema. The build is the automated
contract check. When adding or changing a field, update all three:

1. `src/content.config.ts`
2. `public/admin/config.yml`
3. `functions/api/submit-article.js`

---

## Technical Architecture

### New components needed

| Component | Location | Purpose |
|---|---|---|
| Yleinen Kynä page | `src/pages/fi/yleinen-kyna.astro` | Login/request gate + submission form |
| Submission handler | `functions/api/submit-article.js` | Validates form, commits draft + photos (to `public/images/`) via GitHub App, sends email |
| Access request handler | `functions/api/request-access.js` | Sends access request email via Resend |
| Resend API key | Cloudflare Pages settings | `RESEND_API_KEY` on both environments |
| D1 schema migration | D1 console | `ALTER TABLE users ADD COLUMN perm_laheta_artikkeli INTEGER NOT NULL DEFAULT 0` |

### New Cloudflare secrets

| Secret | Environment | Notes |
|---|---|---|
| `RESEND_API_KEY` | Production + Staging | Resend API key for email notifications |

(No R2 binding needed — submitted photos are committed straight into the repo at
`public/images/`, the same store Sveltia's media library and the static build use.)

### Navigation change

Add to the **Muuta** dropdown in `src/components/Header.astro`:

```
Yleinen Kynä ✍  →  /fi/yleinen-kyna
```

---

## What's Already in Place ✅

- IAM login, session management, provisioning flow (`functions/api/auth/`)
- `requireAuth` with permission checking (`functions/_lib/auth.js`)
- GitHub App for committing (`GITHUB_APP_*` secrets)
- Sveltia draft workflow (`draft: true`, Piilota sivustolta)
- FI required / EN optional per article
- Julkaise esikatseluun → Esikatsele → Julkaise tuotantoon pipeline
- Auto-promote deletions GitHub Action
- `content.config.ts` Zod schema as build-time validator
- `/fi/aseta-salasana` password-setting page for new accounts

---

## What Needs Building

1. **D1 migration** — `ALTER TABLE users ADD COLUMN perm_laheta_artikkeli INTEGER NOT NULL DEFAULT 0`
2. **IAM Käyttäjät UI** — expose `perm_laheta_artikkeli` checkbox in user management
3. **`src/pages/fi/yleinen-kyna.astro`** — page with login gate, access request form, submission form
4. **`functions/api/submit-article.js`** — form handler, commits draft + photos (`public/images/`) via GitHub App, Resend email
5. **`functions/api/request-access.js`** — access request email handler
6. **Resend setup** — verify photoandmoto.fi sending domain, add `RESEND_API_KEY`
7. **Header navigation** — add Yleinen Kynä to Muuta dropdown
8. **DEPLOYMENT.md update** — document new role, Resend setup

---

## Critical Implementation Notes

- **D1 schema migration must happen before** any code referencing
  `perm_laheta_artikkeli` deploys — follow the pattern in DEPLOYMENT.md
- **R2 binding must be added to both** production and staging Pages projects
- **`author` field must be sourced from IAM session, never from form input** —
  prevents contributor from spoofing authorship
- **`draft: true` must be hardcoded** in `submit-article.js` — contributor cannot
  override publication state
- **Photo filenames must be sanitized on upload** (no colons, spaces → hyphens) —
  same rule as `functions/api/mystery/publish.js`
- **Resend sending domain `photoandmoto.fi` must be verified** before emails work
- **Access request form has no CAPTCHA in v1** — monitor for abuse, add
  Turnstile if needed (already in the altumvista stack)
- **No automatic account creation** — editor always approves manually

---

## Effort Estimate

2–3 sessions with CC

## Priority

Medium — implement after current backlog is fully resolved

---

# Phase 2 — AI-Aided Pikauutinen (News Flash)

## Purpose

Enable selected contributors to generate short Finnish news flashes (pikauutiset)
by filling in structured event keywords. Gemini generates a 2-3 sentence news
flash from the keywords. Editor does a quick review and publishes directly to
production — no staging step required for such short content.

This is a lighter, faster content stream than Phase 1 articles — separate
collection, separate page, separate pipeline.

---

## Two Content Streams Under Yleinen Kynä

| Stream | Tab | Output | Pipeline |
|---|---|---|---|
| Phase 1 | Kirjoita artikkeli | Full article — `src/content/articles/fi/` | Full editorial — Sveltia → staging → production |
| Phase 2 | Luo pikauutinen | Short news flash — `src/content/pikauutiset/` | Light editorial — Sveltia → straight to production |

Same page (`/fi/yleinen-kyna`), same permission (`perm_laheta_artikkeli`),
two tabs. No separate IAM flag needed.

---

## Pikauutinen Form Fields

| Field (Finnish UI) | Passed to Gemini | Required | Notes |
|---|---|---|---|
| Aihe | `{topic}` | ✅ | e.g. "MXGP Italia 2026" |
| Kategoria | `{category}` + tone | ✅ | Drives tone — no separate Sävy field |
| Päivämäärä | `{date}` | ✅ | Event date — passed directly to frontmatter |
| Paikka | `{location}` | ✅ | Track, city, country |
| Sää | `{weather}` | ❌ | Weather conditions |
| Positiiviset tapahtumat | `{positive_events}` | ✅ | Who led, podium, key moments |
| Negatiiviset tapahtumat | `{negative_events}` | ❌ | Crashes, DNFs, illness |
| Tulokset | `{results}` | ✅ | Top 3 or results list |
| Muuta | `{other}` | ❌ | Anything else |
| Pääkuva | — not sent to Gemini — | ❌ | Optional hero photo → R2 |

**Category drives tone** — no separate Sävy field:
- MXGP → Kilpailuraportti
- Historical → Historiallinen
- Haastattelu → Haastattelu
- etc.

---

## Field Mapping — Form → Gemini → Frontmatter

| Yleinen Kynä input | Gemini prompt | Pikauutinen frontmatter |
|---|---|---|
| Aihe | `{topic}` | feeds into `title` |
| Kategoria | `{category}` + tone instruction | `category` — passed directly |
| Päivämäärä | `{date}` | `date` — passed directly |
| Paikka | `{location}` | feeds into `title` + body |
| Sää | `{weather}` | feeds into body only |
| Positiiviset tapahtumat | `{positive_events}` | feeds into body |
| Negatiiviset tapahtumat | `{negative_events}` | feeds into body |
| Tulokset | `{results}` | feeds into body |
| Muuta | `{other}` | feeds into body |
| Pääkuva | — | `photo` → committed to R2 |
| — | Gemini generates → `title` | `title` |
| — | Gemini generates → `body` | `body` (2-3 sentences) |
| IAM session | — | `author` — never from form or Gemini |
| hardcoded | — | `draft: true` |
| hardcoded | — | `source: ai_generated` |

---

## Pikauutinen Frontmatter Schema (minimal)

```yaml
title:        # Generated by Gemini — max 80 chars
body:         # Generated by Gemini — 2-3 sentences markdown
date:         # From form — event date
author:       # From IAM session — never from form or Gemini
category:     # From form
photo:        # Optional — R2 URL
draft:        # Always true — hardcoded
source:       # Always "ai_generated" — hardcoded
```

No `subtitle`, `card_image`, `seo_description`, `tags`, `sources`, `show_hero`
— pikauutiset is a separate collection with its own lean Zod schema.

---

## Backend Prompt Template

Hardcoded in `generate-article.js` (not an env var — simpler to iterate):

```
Olet suomalainen moottoriurheilutoimittaja. Kirjoita lyhyt pikauutinen
photoandmoto.fi-sivustolle seuraavista tiedoista.

Aihe: {topic}
Kategoria: {category}
Päivämäärä: {date}
Paikka: {location}
Sää: {weather}
Positiiviset tapahtumat: {positive_events}
Negatiiviset tapahtumat: {negative_events}
Tulokset: {results}
Muuta: {other}

Kirjoita pikauutinen suomeksi. Rakenne:
- Otsikko (max 80 merkkiä) — ytimekäs ja informatiivinen
- Teksti (2-3 lausetta) — tiivis uutisteksti, kaikki oleelliset tiedot

Palauta AINOASTAAN JSON-muodossa, ei muuta tekstiä:
{
  "title": "",
  "body": ""
}
```

---

## Contributor Flow (Phase 2)

1. Opens Yleinen Kynä → clicks **Luo pikauutinen** tab
2. Fills structured keyword form
3. Optionally uploads one hero photo
4. Clicks **Luo pikauutinen**
5. Backend calls Gemini → validates JSON → commits draft to
   `src/content/pikauutiset/<date>-<slug>.md` on dev branch
6. Editor receives Resend notification email with direct Sveltia link

## Editor Flow (Phase 2 — light)

1. Receives email: "Uusi pikauutinen odottaa tarkistusta — [title]"
2. Opens Sveltia → Pikauutiset collection → opens draft
3. Reads 2-3 sentences — quick check for accuracy and appropriateness
4. If OK → toggles `draft: false` → saves
5. Clicks **Julkaise tuotantoon** directly — no staging step needed
6. Pikauutinen appears live on `/fi/pikauutiset` within ~2 minutes

**No Julkaise esikatseluun step** — content is short enough that staging
preview adds no value. Editor goes straight to production.

---

## Site Presence — Pikauutiset

### Dedicated page: `/fi/pikauutiset`
- **FI only** — no EN equivalent
- **Main nav:** Etusivu → **Pikauutiset** → Galleria → Aikakone → Muuta
- Rolling display — latest 10 shown, older archived (kept in git, not deleted)
- Each card: title, body (2-3 sentences), optional photo, timestamp, author
- **No homepage section** — nav link drives traffic directly to the page

### Nav change
```
FI nav: Etusivu | Pikauutiset | Galleria | Aikakone | Muuta ▾ | Yhteystiedot
EN nav: unchanged
```

---

## Photo Storage — R2 (not repo)

Pikauutinen photos go to R2 (`env.UPLOADS`), not the GitHub repo.
Rationale: pikauutiset are ephemeral news items — committing photos to git
would bloat the repo over time. R2 is the right store for ephemeral media.

- `functions/images/[[path]].js` already serves R2 objects at `/images/<file>`
- Sveltia does not need to preview pikauutinen photos (light editorial flow)
- Repo stays lean — only `.md` text files committed for pikauutiset

---

## New Technical Components (Phase 2 only)

| Component | Location | Purpose |
|---|---|---|
| AI generation handler | `functions/api/generate-article.js` | Keyword form → Gemini → validate JSON → commit draft → Resend email |
| Pikauutiset Zod schema | `src/content.config.ts` | Lean schema for pikauutiset collection |
| Sveltia collection | `public/admin/config.yml` | Pikauutiset collection — minimal fields |
| Pikauutiset page | `src/pages/fi/pikauutiset.astro` | Rolling page — latest 10 cards |
| Phase 2 tab | `src/pages/fi/yleinen-kyna.astro` | "Luo pikauutinen" tab alongside Phase 1 |
| Nav update | `src/components/Header.astro` | Add Pikauutiset to FI main nav |

### New Cloudflare secrets needed

| Secret | Environment | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Production + Staging | Google Gemini API key |

No new R2 buckets — `UPLOADS` binding from Phase 1 is reused.
No new Resend setup — `RESEND_API_KEY` from Phase 1 is reused.
No new IAM flags — `perm_laheta_artikkeli` covers both streams.

---

## Content Provenance

All pikauutiset have `source: ai_generated` hardcoded in frontmatter.
All Phase 1 articles have `source: contributor` hardcoded.
Editor-written articles have no `source` field (existing articles unchanged).

This gives the editor full visibility in Sveltia on content origin.

---

## Rate Limiting

- Max 3 pikauutinen generations per contributor per hour (in-memory, Worker-level)
- Prevents Gemini API abuse
- Same pattern as request-access.js rate limiter

---

## Critical Implementation Notes (Phase 2)

- **Gemini response must be parsed as strict JSON** — if parsing fails, return
  error to contributor, do not commit a broken draft
- **`title` and `body` must be non-empty strings** — validate before committing
- **`body` max ~500 chars** — if Gemini returns more, truncate or re-prompt
- **`author` always from IAM session** — Gemini cannot set or override it
- **`draft: true` hardcoded** — contributor cannot override publication state
- **`source: ai_generated` hardcoded** — always set, never from form
- **Photo filenames sanitized** — same rules as submit-article.js
- **Photo optional** — if no photo uploaded, `photo: null` in frontmatter
- **Single source of truth:** `src/content.config.ts` pikauutiset schema —
  update `config.yml` and `generate-article.js` together if schema changes

---

## Effort Estimate (Phase 2)

2 sessions with CC — after Phase 1 is fully accepted and stable on production

## Dependency

Phase 2 requires Phase 1 to be fully built, tested, and promoted to production.
Infrastructure reused from Phase 1: R2 (`UPLOADS`), Resend (`RESEND_API_KEY`),
`perm_laheta_artikkeli` IAM flag, Yleinen Kynä page, GitHub App.
