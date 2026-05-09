#!/usr/bin/env node
// Generates a 1200x630 OG (social-card) image for an article.
//
// Usage:  node scripts/generate-og-image.mjs <article-md-path>
//
// Reads the article's frontmatter (title, featured_image, category), composes
// a card with the featured image as background (darkened gradient), the title
// in white, the category in orange, and the "Photo & Moto" wordmark.
// Writes to public/og/<slug>-<lang>.jpg.
//
// Used by .github/workflows/generate-og-images.yml on every push that
// adds/modifies article markdown.
//
// Fonts: text-to-svg renders text as exact-Montserrat SVG paths using the
// font file from @fontsource/montserrat. Identical output across all
// environments (local Windows, Ubuntu CI, etc.) — no system font dependency.

import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import TextToSVG from 'text-to-svg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = path.resolve(
  __dirname,
  '../node_modules/@fontsource/montserrat/files/montserrat-latin-800-normal.woff'
);

let textToSVG = null;
try {
  textToSVG = TextToSVG.loadSync(FONT_PATH);
} catch (e) {
  console.warn(`Montserrat font not loaded (${e.message}). Falling back to system serif.`);
}

const W = 1200;
const H = 630;
const ORANGE = '#ff9900';

function parseFrontmatter(markdown) {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error('No frontmatter');
  return yaml.load(m[1]) || {};
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

// Naive word wrap by character count. Good enough for OG titles.
function wordWrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  // Cap at 4 lines, append ellipsis if truncated
  if (lines.length > 4) {
    lines.length = 4;
    lines[3] = lines[3].replace(/\S+$/, '…');
  }
  return lines;
}

// Render text as Montserrat-shaped SVG paths via text-to-svg, or fall back
// to a generic <text> element with system font when the font wasn't loaded.
function renderText(text, x, y, fontSize, fill, opts = {}) {
  if (textToSVG) {
    return textToSVG.getPath(text, {
      x,
      y,
      fontSize,
      anchor: 'left top',
      attributes: { fill },
    });
  }
  return `<text x="${x}" y="${y + fontSize * 0.85}" font-family="sans-serif" font-size="${fontSize}" font-weight="800" fill="${fill}">${escapeXml(text)}</text>`;
}

function buildSvgOverlay(title, category) {
  const lines = wordWrap(title || '', 22);
  // Smaller font when more lines, so longer titles fit cleanly
  const fontSize = lines.length <= 2 ? 76 : lines.length === 3 ? 64 : 56;
  const lineHeight = Math.round(fontSize * 1.1);
  // Title block bottom-anchored ~190px from bottom
  const titleBlockHeight = (lines.length - 1) * lineHeight;
  const titleStartY = H - 190 - titleBlockHeight;

  const titlePaths = lines.map((line, i) =>
    renderText(line, 60, titleStartY + i * lineHeight, fontSize, 'white')
  ).join('\n  ');

  const catPath = category
    ? renderText(String(category).toUpperCase(), 60, H - 105, 22, ORANGE)
    : '';

  const wordmarkPath = renderText('PHOTO & MOTO', 60, H - 60, 32, ORANGE);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="black" stop-opacity="0"/>
      <stop offset="35%" stop-color="black" stop-opacity="0"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  ${titlePaths}
  ${catPath}
  ${wordmarkPath}
</svg>`;
}

async function generateOgImage(featuredImagePath, title, category, outputPath) {
  // Resolve featured image. If absent or unreadable, use a black canvas.
  let baseBuffer;
  try {
    if (featuredImagePath && featuredImagePath.startsWith('/')) {
      const localPath = path.join('public', featuredImagePath);
      baseBuffer = await sharp(localPath)
        .resize(W, H, { fit: 'cover' })
        .toBuffer();
    } else {
      throw new Error('No usable featured image');
    }
  } catch (e) {
    // Fallback: solid black
    baseBuffer = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();
  }

  const svg = buildSvgOverlay(title, category);

  const final = await sharp(baseBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  await writeFile(outputPath, final);
  return final.length;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/generate-og-image.mjs <article-md-path>');
    process.exit(1);
  }

  const md = await readFile(inputPath, 'utf8');
  const fm = parseFrontmatter(md);

  const slug = path.basename(inputPath, '.md');
  const lang = inputPath.includes('/fi/') ? 'fi' : inputPath.includes('/en/') ? 'en' : 'fi';

  await mkdir('public/og', { recursive: true });
  const outputPath = path.join('public/og', `${slug}-${lang}.jpg`);

  const bytes = await generateOgImage(fm.featured_image, fm.title, fm.category, outputPath);
  console.log(`Wrote ${outputPath} (${(bytes / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error('generate-og-image failed:', e.message);
  process.exit(1);
});
