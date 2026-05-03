#!/usr/bin/env node
/**
 * Generate /llms.txt from public/data/site-index.json.
 *
 * Output: public/llms.txt
 *
 * The llms.txt convention (proposed by Jeremy Howard, adopted by Anthropic,
 * Stripe, Cloudflare, Astro, etc.) is a plain-markdown index a site exposes
 * at /llms.txt so AI agents can discover its content without parsing HTML.
 *
 * Spec (informal): https://llmstxt.org/
 *
 * This script reads the site-index.json (produced by
 * scripts/generate-site-index.mjs immediately before this script runs),
 * so adding new content automatically updates llms.txt.
 *
 * Bilingual handling: site-index.json only carries the FI URL per entry.
 * For sections that have an EN equivalent (articles, galleries, mxgp), this
 * script computes the EN URL by string-replacing the FI path segment and
 * lists both URLs per entry.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const INDEX_PATH = join(ROOT, 'public', 'data', 'site-index.json');
const OUT_PATH = join(ROOT, 'public', 'llms.txt');
const SITE = 'https://www.photoandmoto.fi';

// FI -> EN path mapping. If a type isn't here, it has no EN counterpart.
const FI_TO_EN_PATH = {
  '/fi/aikakone/':   '/en/time-machine/',
  '/fi/galleria/':   '/en/gallery/',
  '/fi/mxgp-2026/':  '/en/mxgp-2026/',
};

// Section ordering and headings for the output file.
// `type` MUST match the `type` field in site-index.json entries.
const SECTIONS = [
  { type: 'article',  heading: 'Articles (Aikakone / Time Machine)',  note: 'Long-form pieces on motorsport history, riders, and racing. Bilingual: each article exists in both Finnish and English.' },
  { type: 'gallery',  heading: 'Photo galleries (Galleria / Gallery)', note: 'Curated photo collections by era and theme. Bilingual.' },
  { type: 'stats',    heading: 'Statistics (Tilastot)',                note: 'Championship results, race winners, and historical records. Finnish only.' },
  { type: 'calendar', heading: 'Race calendar (Kalenteri)',            note: 'Upcoming and past race calendar. Finnish only.' },
  { type: 'mxgp',     heading: 'MXGP 2026 season tracker',             note: 'Live results, standings, and AI-generated highlights for the current MXGP season. Bilingual.' },
  { type: 'podcast',  heading: 'Podcast',                              note: 'Episodes on Finnish motorsport history. Finnish only.' },
];

function clean(s) {
  return String(s ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toAbsolute(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : `${SITE}${url}`;
}

function deriveEnUrl(fiUrl) {
  if (!fiUrl) return null;
  for (const [fiPrefix, enPrefix] of Object.entries(FI_TO_EN_PATH)) {
    if (fiUrl.startsWith(fiPrefix)) {
      return fiUrl.replace(fiPrefix, enPrefix);
    }
  }
  return null;
}

function buildLink(entry) {
  const title = clean(entry.title || 'Untitled');
  const fiAbs = toAbsolute(entry.url);
  const enRel = deriveEnUrl(entry.url);
  const enAbs = toAbsolute(enRel);

  if (!fiAbs) {
    // Fallback: no URL on entry — emit title only with a comment, so the file
    // still parses but the broken entry is visible in review.
    return `- ${title} (URL missing in site-index.json)`;
  }

  if (enAbs) {
    return `- [${title}](${fiAbs}) — English: [${title}](${enAbs})`;
  }
  return `- [${title}](${fiAbs})`;
}

async function main() {
  let raw;
  try {
    raw = await readFile(INDEX_PATH, 'utf8');
  } catch (err) {
    console.error(`generate-llms: could not read ${INDEX_PATH} — has generate-site-index.mjs run yet?`);
    console.error(err.message);
    process.exit(1);
  }

  const data = JSON.parse(raw);
  const entries = Array.isArray(data) ? data : (data.entries ?? []);

  if (!entries.length) {
    console.error('generate-llms: site-index.json contained zero entries — refusing to overwrite llms.txt.');
    process.exit(1);
  }

  const lines = [];
  lines.push('# Photo & Moto');
  lines.push('');
  lines.push('> Motorsport history photos, articles, and stats — bilingual (Finnish primary, English secondary), focused on motocross with broader racing coverage.');
  lines.push('');
  lines.push('Photo & Moto is a community-driven archive at https://www.photoandmoto.fi covering Finnish and international motorsport history. The site combines curated photo galleries, long-form historical articles, championship statistics, an MXGP 2026 season tracker, a race calendar, and a podcast.');
  lines.push('');
  lines.push('Two complementary search experiences are available: an AI-powered Q&A search (`/fi/haku`, `/en/haku`) and a keyword-based full-text search (`/fi/etsi`, `/en/search`).');
  lines.push('');
  lines.push('Most original article content is in Finnish; English versions are provided for articles, galleries, and the MXGP season tracker. Statistics, race calendar, and podcast pages are Finnish-only.');
  lines.push('');

  for (const section of SECTIONS) {
    const items = entries.filter(e => e.type === section.type);
    if (!items.length) continue;

    lines.push(`## ${section.heading}`);
    if (section.note) {
      lines.push('');
      lines.push(section.note);
    }
    lines.push('');
    for (const item of items) {
      lines.push(buildLink(item));
    }
    lines.push('');
  }

  // Optional housekeeping section: agents can use this to find search and sitemap.
  lines.push('## Optional');
  lines.push('');
  lines.push(`- [Sitemap](${SITE}/sitemap-index.xml): XML sitemap index with all pages and hreflang alternates.`);
  lines.push(`- [Keyword search (FI)](${SITE}/fi/etsi) — English: [Keyword search (EN)](${SITE}/en/search): Static full-text search across articles and galleries.`);
  lines.push(`- [AI search (FI)](${SITE}/fi/haku) — English: [AI search (EN)](${SITE}/en/haku): Natural-language Q&A over site content.`);
  lines.push(`- [Identify a photo (FI)](${SITE}/fi/tunnistamatta) — English: [Identify a photo (EN)](${SITE}/en/identify): Community-driven identification of unidentified historical motorsport photos.`);
  lines.push('');

  const out = lines.join('\n');
  await writeFile(OUT_PATH, out, 'utf8');

  const sectionsRendered = SECTIONS.filter(s => entries.some(e => e.type === s.type)).length;
  console.log(`✅ llms.txt generated`);
  console.log(`   ${entries.length} entries across ${sectionsRendered} sections`);
  console.log(`   ${out.length} bytes`);
  console.log(`   Saved to: ${OUT_PATH}`);
}

main().catch(err => {
  console.error('generate-llms: failed:', err);
  process.exit(1);
});
