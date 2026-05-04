# Photo & Moto — Migration Playbook

A reusable template for major framework or platform migrations on the Photo & Moto site, plus the worked plan for the current Astro 4.5 → 6.x upgrade.

This doc serves two purposes. The first half is a generic checklist — anything you do that touches the build pipeline, dependencies, runtime, or schema should follow this shape. The second half is a concrete, step-by-step plan for the specific Astro 6 upgrade we're about to do, kept here so future maintainers can see how the template was applied in practice.

For day-to-day workflow see `README.md`. For environment setup, secrets, and recovery see `DEPLOYMENT.md`.

---

## Part 1 — Reusable migration template

The site has a `dev` → `main` branching model with separate Cloudflare Pages projects and separate D1 databases per environment (see `DEPLOYMENT.md`). Every migration described here should exploit that isolation: do all the work on `dev`, verify on staging, and only promote to production once the staging build has soaked for a few days.

### Phase A — Decide and document

Before touching code, write down the answers to four questions in this file (or a sibling doc):

| Question | Why it matters |
|---|---|
| What problem does this migration solve? | If you can't articulate it, the migration probably isn't worth the risk. |
| What's the visitor-facing benefit? | Internal-only upgrades (security, supportability) are valid, but should be flagged as such so the cost/benefit is honest. |
| What could go wrong, and what's the rollback? | Every migration on this stack should be revertable in ~2 minutes via `git revert` and a Cloudflare auto-redeploy. If a step isn't, that's a red flag. |
| What's the soak time on staging before promoting? | Depends on blast radius — small CSS change can promote same-day, framework upgrade should soak 2–7 days. |

The decision section should also list any **prerequisites** (Node version, Cloudflare build settings, secrets, schema changes) and any **out-of-scope items** explicitly excluded from this migration so they don't creep in.

### Phase B — Pre-flight

Before opening the working branch, confirm the environment is in a known-good state. The minimum checks are: `dev` is currently building successfully on staging, there are no uncommitted local changes, the latest production build on `main` is green, and any external dependencies (Node version on Cloudflare, GitHub App credentials, D1 schema) are at the versions the migration expects.

If the migration involves a D1 schema change, follow the rule from `DEPLOYMENT.md`: **migrate the schema before merging the code change.** Code that queries a column the live database doesn't have will start failing immediately on deploy.

### Phase C — Working branch

All migration work happens on a named branch off `dev`, never directly on `dev` itself:

```bash
git checkout dev
git pull
git checkout -b migrate-<short-name>
```

Work proceeds as a sequence of independently testable commits. Each commit should leave the site in a buildable, deployable state — even if the migration is only partially complete. This is what makes `git bisect` and `git revert` useful later. The cardinal sin is a single 800-line commit titled "upgrade everything" that can't be partially rolled back.

When the migration is split across multiple concerns (e.g. "upgrade framework" + "add new feature" + "remove obsolete script"), each concern is its own commit, in dependency order.

### Phase D — Local verification

Before pushing, run the full local pipeline:

```bash
npm install
npm run build
npm run preview
```

The build must complete with no errors and no new warnings. Click through the site locally and verify the parts most likely to be affected by the migration. For framework or build-tool changes, that means hitting at least one page of every type: landing, gallery index, gallery detail, article, calendar, stats, MXGP, podcast, Tunnista kuva.

### Phase E — Staging verification

Push the branch and open a PR against `dev`. Cloudflare Pages auto-builds a preview at the PR URL within ~2 minutes. The verification checklist on staging is stricter than local because staging hits the real D1 database, real Pages Functions, and the real Worker runtime:

The build must be green. The site must render in both Finnish and English. All galleries must load with their PhotoSwipe lightbox intact. At least one article page must validate its JSON-LD schema (the PowerShell snippet in `README.md` § SEO works for this). The Tunnista kuva flow must work end-to-end: admin login, view photo, comment, vote, save metadata, publish to gallery. The mystery help block on the landing page must render. There must be no console errors and no failed network requests.

If any check fails, fix it on the working branch — do not merge a partially-broken state into `dev`. Staging is allowed to be broken on a working branch; `dev` is not.

### Phase F — Soak

Once the PR merges into `dev`, leave it there for a soak period proportional to the migration's blast radius. Documentation-only or content-only changes can promote same-day. CSS or template changes can promote next day. Framework upgrades, schema migrations, or anything touching the publish pipeline should soak 2–7 days. Use the staging URL as your daily browser homepage during this period — subtle bugs surface faster when you're actually using the site rather than just spot-checking it.

### Phase G — Production promotion

When confident, open a PR `dev → main`. Review the full diff one more time (this is the last point at which production sees a clean slate). Merge the PR. Cloudflare auto-deploys to `www.photoandmoto.fi` within ~2 minutes.

Verify production with the same checklist used on staging. If anything is wrong, the rollback is `git revert` on `main` and push — Cloudflare redeploys the previous version automatically.

### Phase H — Cleanup and document

After the migration has been live on production for a week with no issues, the working branch can be deleted, any temporary feature flags can be removed, and any new operational knowledge (gotchas, surprises, things that should have been done differently) should be appended to this file under "Lessons learned" so the next migration benefits.

---

## Part 2 — Current migration: Astro 4.5 → 6.x + Pagefind + llms.txt

### Decision summary

| Question | Answer |
|---|---|
| Problem solved | Astro 4.5 has been unsupported for over a year (two majors behind). No new security patches, no bug fixes, gradually falling behind on Node and integration compatibility. |
| Visitor-facing benefit | New site search via Pagefind (currently no search at all). New `llms.txt` exposure for AI crawlers (ChatGPT, Claude, Perplexity), an emerging SEO surface. Astro 6 itself is mostly internal. |
| Worst-case failure | Build fails on Cloudflare after merge to `main`. Mitigation: full work happens on `dev`/staging first, soak period before promoting, `git revert` rolls back in ~2 minutes. |
| Soak time | Minimum 3 days on `dev` after merge before promoting to `main`. |

**Prerequisites:**

- Node.js 22 set as the build runtime in both Cloudflare Pages projects (Astro 6 requires Node 22+)
- All existing Pages secrets remain valid (no rotation needed for this migration)
- D1 schema unchanged by this migration

**Explicitly out of scope:**

- Live Content Collections (decided not worth the effort for the current mystery block design)
- View Transitions / `<ClientRouter />` (separate decision, can be added later as its own PR)
- Astro Actions migration of Pages Functions (Pages Functions stay as they are)
- Workerd dev runtime adoption (optional later improvement)

### Phase 1 — Astro 4.5 → 6.x upgrade

The upgrade is the riskiest of the three changes, so it goes first on a clean base. If something breaks in the upgrade, we don't want it tangled with new feature commits.

Run the automated upgrade tool:

```bash
npx @astrojs/upgrade
```

This bumps `astro` and all `@astrojs/*` integrations to their latest versions in `package.json`. Review the diff and confirm the integrations being updated are all ones we actually use.

Several breaking changes are likely to require manual fixes. The deprecated `<ViewTransitions />` component has been removed in favor of `<ClientRouter />`, so any import of `ViewTransitions` from `astro:transitions` becomes `ClientRouter`. The `Astro.glob()` helper has been removed entirely — any usage must be rewritten with `import.meta.glob()`. Zod has been upgraded from v3 to v4, which mostly affects content collection schemas in `src/content/config.ts` (or wherever the collections are defined); most schemas migrate cleanly, but `npm run build` will surface anything that doesn't.

The Cloudflare adapter has changes to `Astro.locals.runtime`. We don't use it directly in the Astro layer (our server-side logic lives in Pages Functions under `functions/api/mystery/*`, which are independent of Astro), so this is unlikely to bite — but worth grepping the codebase to confirm.

After the manual fixes, run the local pipeline (`npm install`, `npm run build`, `npm run preview`) and verify the site renders. Commit:

```bash
git add .
git commit -m "chore: upgrade Astro 4.5 → 6.x"
git push -u origin migrate-astro-6
```

Open the PR against `dev` and verify on the staging preview URL. Do not proceed to Phase 2 until staging is fully green — every gallery loads, every article renders, the mystery help block is visible, the admin flow works.

### Phase 2 — Pagefind search

Pagefind is a static-first search engine that indexes the built `dist/` folder and ships a small client widget. It replaces our hand-rolled `scripts/generate-site-index.mjs` and the `public/data/site-index.json` artifact, which also resolves the longstanding backlog item about that file showing as modified on every branch checkout.

Install Pagefind and the Astro integration:

```bash
npm install -D pagefind astro-pagefind
```

Add the integration to `astro.config.mjs` alongside the existing integrations. Tag the searchable region of each layout with `data-pagefind-body` — typically the `<main>` element in the article and gallery layouts. Pagefind picks up the `lang` attribute on the `<html>` tag automatically and produces per-language indexes, so Finnish results don't mix with English.

Build the search page at `/fi/haku/` and `/en/search/`, each importing the Pagefind UI assets from `/pagefind/` (which Pagefind generates at build time) and instantiating `PagefindUI` against a `#search` div. Customize the placeholder and zero-results strings per language.

Add a search icon to the header navigation linking to the per-language search page. A keyboard shortcut (⌘K / Ctrl+K) is optional but cheap.

After Pagefind is wired up and tested, the old search infrastructure can be removed: delete `scripts/generate-site-index.mjs`, remove the corresponding script entry from `package.json`, and delete `public/data/site-index.json`. Verify nothing else imports or fetches from `/data/site-index.json`.

Local test, then commit:

```bash
git add .
git commit -m "feat: add Pagefind search, replace custom site-index"
git push
```

### Phase 3 — llms.txt for AI crawlers

`llms.txt` is an emerging standard for exposing site content in a structured, AI-friendly format. The `agent-markup` integration generates both an `llms.txt` index file and per-page Markdown mirrors at build time.

```bash
npm install -D agent-markup
```

Add the integration to `astro.config.mjs` with `output: 'llms.txt'` and `includeMarkdownMirrors: true`. The markdown mirrors mean an article at `/fi/aikakone/some-slug/` also becomes available at `/fi/aikakone/some-slug.md`, which is what AI crawlers prefer.

Update `public/robots.txt` to explicitly allow the AI crawlers we want indexing the site (GPTBot, ClaudeBot, PerplexityBot are the main ones as of mid-2026). The existing sitemap reference stays.

Build and verify `dist/llms.txt` exists and has plausible content. Commit:

```bash
git add .
git commit -m "feat: add llms.txt for AI crawler indexing"
git push
```

### Phase 4 — Final staging verification

Once all three commits are on the working branch, run through the full staging checklist:

The homepage must render with the mystery help block visible. Every gallery category must load, with PhotoSwipe lightbox intact on click. At least one article page must pass JSON-LD validation (use the PowerShell snippet from `README.md` § SEO). The search must return results for a known query in both Finnish and English. The `/llms.txt` URL must be accessible and contain a structured index. The full Tunnista kuva flow must work: admin login, photo upload (with the Canvas thumbnail generator), comment, save metadata, publish to gallery — and the publish must commit to `dev`, not `main`, proving the `CF_PAGES_BRANCH` detection still works after the upgrade. There must be no console errors. GA4 must still fire.

If anything fails, fix on the working branch and re-verify. Do not merge a broken state into `dev`.

### Phase 5 — Merge and soak

Merge the PR into `dev`. Use the staging URL as a daily browser destination for the next 3–7 days. Look for subtle issues: layout shift on slow connections, FI/EN switcher edge cases, behaviour after the publish pipeline runs, anything that feels different from before.

### Phase 6 — Production promotion

Open PR `dev → main`. Review the full diff. Merge. Production deploys in ~2 minutes. Verify the same checklist on `www.photoandmoto.fi`. If anything is wrong, `git revert` the merge commit on `main` and push — Cloudflare redeploys the previous version automatically.

### Phase 7 — Cleanup

Delete the `migrate-astro-6` branch. Update `README.md` to reflect that the site is on Astro 6 and uses Pagefind for search. Update the "Backlog" section to remove the resolved `site-index.json` item. Append any lessons learned to the bottom of this file.

---

## Lessons learned

Hard-won lessons from the Astro 4.5 → 6.2.1 + Pagefind + llms.txt migration. Each one cost real time on Day 1 of the migration; logged here so the next major upgrade doesn't re-pay the same tuition.

### 1. Two-strike rule

If the second attempt at a problem also fails, **stop guessing**. No third attempt without one of the following: read the source code of the thing you're fighting, inspect the actual DOM in the browser, or question the framing of the problem itself. Most "third attempts" on this project's migration day were just the second attempt with a different typo — they didn't address the underlying misunderstanding, so they couldn't succeed.

### 2. Verify before optimizing

When overriding a third-party library's CSS or JS, the **first** action is to read what the library actually ships, not to assume from the docs or from prior experience with similar tools. Pagefind's clear-button styling cost more time than it should have because we wrote overrides against an assumed DOM structure before reading the rendered DOM. Five minutes with the dev tools would have saved an hour of CSS specificity wars.

### 3. Name the frame out loud

When stuck, **say the working assumption out loud** before another attempt. Something like: "I'm assuming the clear button must be inside the input element." If the user can challenge the frame ("…why does it have to be inside?"), one cycle of wasted work is avoided. If the user agrees the frame is right, at least the next attempt is informed by an explicit hypothesis instead of an implicit one.

### 4. Chat formatting contamination

Strings like `a.target`, `[System.IO]`, `article.id`, or anything that looks like a hostname or class reference get auto-formatted into markdown links (`[token](http://token)`) when copied through chat into PowerShell. The link wrappers break the command silently — PowerShell sees a different string than what was intended. Mitigations:

- Prefer **file downloads over copy-paste edits** for anything non-trivial. The artifact survives the chat round-trip; pasted commands don't.
- When copy-paste is unavoidable, **build PowerShell strings via concatenation** (`'a' + '.' + 'target'`) so no token in the source matches the chat's auto-link pattern.
- Use `(Resolve-Path ...).Path` instead of relative `$path` variables when the path is dynamic — fewer chances for a token to be eaten.

### 5. PowerShell encoding

Repeated `Get-Content` / `Set-Content` cycles re-encode UTF-8 → Windows-1252 → corrupted bytes. Each round-trip silently mangles `§`, `→`, `—`, `–`, `Ä`, `Ö`, etc. The cycle is invisible until someone views the file in a tool that doesn't share PowerShell's wrong assumption. Always edit non-ASCII content with:

```powershell
$bytes = [System.IO.File]::ReadAllBytes($path)
$content = [System.Text.Encoding]::UTF8.GetString($bytes)
# ...modify $content...
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
```

The `$false` to `UTF8Encoding` matters — it suppresses the BOM, which Astro's parser and Cloudflare's static asset handling both prefer absent.

### 6. PowerShell template-literal escaping

Wrapping JS template literals (`` `${var}` ``) inside a PowerShell **double-quoted** string drops the `$` because PowerShell tries to interpolate it as a variable. Two safe patterns:

- Use **single-quoted PowerShell strings** (`'...'`) when the target file content contains `${...}` — single quotes don't interpolate.
- Use **string concatenation** for patterns that must contain both `'` and `${...}`: `"part1" + '${var}' + "part2"`.

The mistake is silent: the file gets written with a missing `$` and the JS just breaks at runtime with a confusing reference error.

### 7. PowerShell `Select-String` display

The terminal renders `a.target` as a markdown-link visually, **even when the underlying file content is plain text** with no link wrapper. Don't trust visual output of `Select-String`, `Get-Content`, or any ANSI-rendering tool when verifying that a fix actually landed. Verify with a regex match count on the raw bytes:

```powershell
([regex]::Matches((Get-Content $path -Raw), 'pattern')).Count
```

If the count is what you expect, the fix is real regardless of what the terminal showed.

---

## License

© 2026 Photo & Moto — All rights reserved.
