# Infrastructure Strategy — Photo & Moto

**Status: Documented — implementation after Phase 1 + Phase 2 stable on production**

---

## Architecture Overview

| Data Type | Storage | Rationale |
|---|---|---|
| Articles, pikauutiset, categories (text/markdown) | GitHub | Free, unlimited, Sveltia-native |
| Editorial images (uploaded via Sveltia) | Cloudflare R2 | Bypass repo, $0 egress |
| Contributor images (submitted via Avustajat) | GitHub `public/images/` (current) → R2 (planned) | Migration needed |
| User accounts, sessions, access requests | Cloudflare D1 | Interactive/transactional data only |

---

## Current State vs Target

### GitHub — Text Only ✅ Mostly compliant
- Articles, pikauutiset, categories all in GitHub as markdown ✅
- Sveltia commits directly to repo ✅
- GAP: Contributor-submitted images (Phase 1) committed to
  `public/images/` in repo — violates images-bypass-GitHub rule.
  Low volume now but will grow.

### Cloudflare R2 — Images ⚠️ Partially compliant
- R2 bucket `photoandmoto-uploads` exists ✅
- Pikauutiset photos go to R2 ✅
- GAP: Sveltia NOT configured to use R2 as media library —
  editorial image uploads still commit to repo
- GAP: No custom subdomain connected to R2
- GAP: Astro `<Image />` not verified for R2-served assets

### Cloudflare D1 — User interactions only ✅ Compliant
- IAM users, sessions, login attempts ✅
- `access_requests` table (planned) ✅
- No content management in D1 ✅

---

## Planned Improvements

### 🟢 Low risk

**R2 custom subdomain**
Connect `media.photoandmoto.fi` subdomain to the R2 bucket in
Cloudflare dashboard. Replaces default `pub-xxx.r2.dev` URLs.
- Owner action: Cloudflare dashboard → R2 → photoandmoto-uploads
  → Settings → Custom domain → add `media.photoandmoto.fi`
- No code changes needed

**Astro `<Image />` for R2 assets**
Use Astro's native Image component for R2-served images.
Automatically converts to .webp/.avif and caches on Cloudflare edge.
- Low risk: additive change, existing images unaffected
- Implement after R2 subdomain is live

### 🟡 Medium risk

**Sveltia → R2 media library**
Configure `public/admin/config.yml` to use R2 as Sveltia's
media backend. Future editorial image uploads bypass GitHub.
Existing repo images stay in repo — no migration needed.
- Requires: R2 API token with Edit permissions
- Requires: R2 subdomain live first
- Test thoroughly on staging before production
- Change: `config.yml` media_folder + public_folder settings

**Retire `functions/images/[[path]].js`**
Once R2 subdomain is live and confirmed working, the serving
function becomes redundant. Remove it.
- Only safe AFTER R2 subdomain confirmed working end-to-end

### 🔴 High risk

**Contributor article images → R2**
`functions/api/submit-article.js` currently commits photos to
`public/images/` in GitHub repo. Move to R2.
- Risk: existing submitted articles have images in repo,
  new ones would go to R2 — inconsistency unless migrated
- Requires: dedicated migration session
- Requires: Phase 1 + Phase 2 stable on production first
- Do NOT attempt during active feature development

---

## Implementation Order

1. Phase 1 + Phase 2 promoted to production (main) ← current priority
2. R2 custom subdomain (owner action, no code)
3. Sveltia → R2 media library (code + config, staging test first)
4. Astro `<Image />` for R2 assets
5. Retire `functions/images/[[path]].js`
6. Contributor article images → R2 migration (dedicated session)

---

## GitHub Repo Size Targets

| Content | Est. size | Notes |
|---|---|---|
| Articles (text) | ~5 KB each | Will never be an issue |
| Pikauutiset (text) | ~1 KB each | Will never be an issue |
| Contributor images (current) | ~500 KB each | Risk if volume grows |
| Editorial images (after R2 migration) | 0 bytes | Bypasses repo entirely |

Target: keep repo under 500 MB total.
Current risk: contributor images in `public/images/` — monitor.

---

## R2 Storage Estimate

- Free tier: 10 GB
- Average optimized image: ~150 KB
- Capacity: ~65,000 images on free tier
- Current usage: minimal (pikauutiset photos only)
- Risk level: Low for foreseeable future

---

*Last updated: June 2026*
*Owner: Arto T Vilkman*
