# Yleinen Kynä — Community Article Submission

**Photo & Moto — Concept Design v1.0**
**Status: Planned — not yet implemented**

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
| Submission handler | `functions/api/submit-article.js` | Validates form, uploads photos to R2, commits draft via GitHub App, sends email |
| Access request handler | `functions/api/request-access.js` | Sends access request email via Resend |
| R2 bucket | Cloudflare dashboard | `photoandmoto-uploads` — photo storage |
| R2 binding | Cloudflare Pages settings | Variable name `UPLOADS` on both production and staging |
| Resend API key | Cloudflare Pages settings | `RESEND_API_KEY` on both environments |
| D1 schema migration | D1 console | `ALTER TABLE users ADD COLUMN perm_laheta_artikkeli INTEGER NOT NULL DEFAULT 0` |

### New Cloudflare secrets

| Secret | Environment | Notes |
|---|---|---|
| `RESEND_API_KEY` | Production + Staging | Resend API key for email notifications |
| `UPLOADS` (R2 binding) | Production + Staging | R2 bucket binding for photo uploads |

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
4. **`functions/api/submit-article.js`** — form handler, R2 upload, GitHub App commit, Resend email
5. **`functions/api/request-access.js`** — access request email handler
6. **Cloudflare R2 bucket** — create `photoandmoto-uploads`, bind as `UPLOADS`
7. **Resend setup** — verify photoandmoto.fi sending domain, add `RESEND_API_KEY`
8. **Header navigation** — add Yleinen Kynä to Muuta dropdown
9. **DEPLOYMENT.md update** — document new role, R2 setup, Resend setup

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

# Phase 2 — AI-Aided Article Creation

## Purpose

Lower the barrier for community contributions further — a contributor only needs
to provide key facts and keywords. Gemini generates a full Finnish article draft
from a backend prompt template. Editor reviews and publishes as in Phase 1.

## Contributor Flow

1. Opens Yleinen Kynä → selects "Luo artikkeli tekoälyn avulla"
2. Fills in a simple keyword form:
   - **Aihe** (topic) — e.g. "Heikki Mikkola, 1974 MM-kausi"
   - **Kategoria** (dropdown — same as Phase 1)
   - **Avainsanat** (key names, events, places, dates)
   - **Sävy** (tone) — Historiallinen / Uutinen / Haastattelu
   - **Pääkuva** (photo upload — optional)
3. Clicks **Luo artikkeli**
4. Backend calls Gemini with a pre-made prompt template + contributor keywords
5. Gemini returns structured JSON
6. System validates JSON, commits draft to GitHub with `draft: true`
7. Editor receives notification email

## Editor Flow

Same as Phase 1 — editor reviews AI draft in Sveltia, edits as needed, adds
any missing details, decides on EN translation, publishes via Julkaise.

## Backend Prompt Template

Stored in Cloudflare env var `GEMINI_ARTICLE_PROMPT` — never exposed to the
contributor. Example:

```
Olet suomalainen moottoriurheilutoimittaja. Kirjoita artikkeli
photoandmoto.fi-sivustolle seuraavista tiedoista:

Aihe: {topic}
Avainsanat: {keywords}
Kategoria: {category}
Sävy: {tone}

Kirjoita artikkeli suomeksi. Rakenne:
- Otsikko (max 80 merkkiä)
- Alaotsikko (max 120 merkkiä)
- Ingressi (2-3 lausetta)
- H2-väliotsikot ja kappaleet
- SEO-kuvaus (50-160 merkkiä)

Palauta AINOASTAAN JSON-muodossa, ei muuta tekstiä:
{
  "title": "",
  "subtitle": "",
  "body": "",
  "seo_description": "",
  "tags": []
}
```

## Field Mapping — Gemini Output → Sveltia

| Gemini JSON output | Frontmatter key | Source |
|---|---|---|
| `title` | `title` | Generated by Gemini |
| `subtitle` | `subtitle` | Generated by Gemini |
| `body` | `body` | Generated markdown |
| `seo_description` | `seo_description` | Generated by Gemini |
| `tags` | `tags` | Generated + contributor keywords merged |
| — | `category` | From contributor form |
| — | `featured_image` | From contributor photo upload → R2 |
| — | `author` | From IAM session — never from form |
| — | `date` | Auto — submission date |
| — | `draft` | Always `true` |

Single source of truth remains `src/content.config.ts` — Zod validates the
committed frontmatter at build time regardless of which phase generated it.

## What's Different from Phase 1

| Aspect | Phase 1 | Phase 2 |
|---|---|---|
| Contributor writes body | ✅ Yes | ❌ No — Gemini writes it |
| Contributor form complexity | Full article form | Keyword form only |
| Backend function | `submit-article.js` | `generate-article.js` |
| Gemini involvement | None | Backend API call |
| Photo upload | Yes | Optional |
| Result quality | Contributor's own words | AI draft — needs editor review |

## New Technical Components (Phase 2 only)

| Component | Location | Purpose |
|---|---|---|
| AI generation handler | `functions/api/generate-article.js` | Receives keywords, calls Gemini, validates JSON, commits draft, sends email |
| Prompt template env var | `GEMINI_ARTICLE_PROMPT` | Cloudflare env var — backend prompt, never exposed |
| Phase 2 form section | `src/pages/fi/yleinen-kyna.astro` | "Luo artikkeli tekoälyn avulla" keyword form |

No new IAM roles, R2 buckets, or Resend setup needed beyond Phase 1 — all
infrastructure is shared.

## Critical Implementation Notes (Phase 2)

- **Gemini response must be parsed as strict JSON** — if parsing fails, return error
  to contributor and do not commit a broken draft
- **Generated body must be validated as non-empty markdown** before committing
- **`author` always from IAM session** — Gemini cannot set or override it
- **`draft: true` hardcoded** — same as Phase 1
- **Prompt template versioning:** store prompt version in frontmatter as a comment
  so editor knows which prompt generated the draft (useful for quality tracking)
- **Rate limit `generate-article.js` per user session** to prevent Gemini API abuse
  (e.g. max 3 generations per hour per contributor)

## Effort Estimate (Phase 2)

1–2 sessions with CC — after Phase 1 is fully built and stable

## Dependency

Phase 2 requires Phase 1 infrastructure to be in place:
R2 bucket, Resend, `perm_laheta_artikkeli` IAM flag, Yleinen Kynä page.
