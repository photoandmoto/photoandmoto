#!/usr/bin/env node
// Compresses oversized article images in-place.
//
// Run by .github/workflows/compress-article-images.yml on every push that
// adds/modifies files in public/images/. Decap saves trigger this; so do
// publish.js commits and any manual image push.
//
// Usage:  node scripts/compress-article-images.mjs <file1> <file2> ...
//
// For each input:
//   - Skip if file is already small (<= MAX_WIDTH wide AND <= SKIP_SIZE_BYTES)
//   - Resize to MAX_WIDTH if wider (downscale only, never upscale)
//   - Re-encode:
//       JPEG -> mozjpeg quality 82
//       PNG  -> compression 9, palette and truecolour both tried, smaller wins
//       WebP -> quality 82
//   - Skip the write unless the new buffer is at least MIN_SAVING_RATIO
//     smaller (avoids pointless rewrites of already-optimised files, which
//     cost generational quality loss and a fresh blob in git history)
//   - Log a NOTE for oversized PNGs: photos belong in JPEG, but converting
//     means renaming, and the article markdown references the filename, so
//     that call is left to a human
//
// Exit codes: 0 always (we don't fail the push for image issues).

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 82;
const SKIP_SIZE_BYTES = 200 * 1024; // 200 KB

// Minimum saving required before we rewrite a file. Without this, the only
// guard was "output must be smaller than input", so an already-compressed
// image that shrank by 5 bytes still got rewritten on every touch. Observed
// on 2026-08-19: Jawa ISDT 3 (-81 bytes), The red tank (-5), hero-bg (-45),
// Kawa AMA (-422) — ten-odd files re-encoded for ~0.1% or less. Two costs:
// generational JPEG loss (each pass re-encodes q82 on top of q82), and repo
// bloat (git stores a whole new ~300 KB blob per rewrite, forever).
const MIN_SAVING_RATIO = 0.05; // must save at least 5%

function fmt(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function processImage(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    console.log(`SKIP (not jpg/png/webp): ${filepath}`);
    return;
  }

  let originalBuf;
  try {
    originalBuf = await readFile(filepath);
  } catch (e) {
    console.log(`SKIP (unreadable): ${filepath} — ${e.message}`);
    return;
  }

  const originalSize = originalBuf.length;
  const meta = await sharp(originalBuf).metadata();
  const width = meta.width || 0;

  if (originalSize <= SKIP_SIZE_BYTES && width <= MAX_WIDTH) {
    console.log(`SKIP (already small): ${filepath} (${fmt(originalSize)}, ${width}px)`);
    return;
  }

  let pipeline = sharp(originalBuf);
  if (width > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
  }

  let outputBuf;
  if (ext === '.jpg' || ext === '.jpeg') {
    outputBuf = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  } else if (ext === '.png') {
    // `palette: true` quantises to a 256-colour palette. That's right for
    // logos and flat graphics, and wrong for photographs — on a photo it
    // either wrecks quality or produces a LARGER file, which then trips the
    // saving threshold above and the file is skipped forever. Two article
    // photos saved as PNG (961 KB and 859 KB) sat untouched this way.
    // So: encode both ways, keep whichever is smaller.
    const pngBase = () => {
      const p = sharp(originalBuf);
      return width > MAX_WIDTH
        ? p.resize({ width: MAX_WIDTH, withoutEnlargement: true })
        : p;
    };
    const [paletted, truecolour] = await Promise.all([
      pngBase().png({ compressionLevel: 9, palette: true }).toBuffer(),
      pngBase().png({ compressionLevel: 9, palette: false }).toBuffer(),
    ]);
    outputBuf = paletted.length <= truecolour.length ? paletted : truecolour;

    // PNG is the wrong container for a photograph regardless of how well it
    // compresses — the same image as JPEG q82 is typically 5-10x smaller.
    // We do NOT convert automatically: that means renaming the file, and the
    // article markdown references it by name. Flag it for a human instead.
    if (outputBuf.length > SKIP_SIZE_BYTES) {
      console.log(
        `NOTE: ${filepath} is a ${fmt(outputBuf.length)} PNG. If this is a ` +
        `photograph, re-save it as JPEG and update the article reference — ` +
        `PNG cannot get this much smaller.`
      );
    }
  } else if (ext === '.webp') {
    outputBuf = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
  }

  if (outputBuf.length >= originalSize * (1 - MIN_SAVING_RATIO)) {
    const delta = 100 - (100 * outputBuf.length) / originalSize;
    const change = delta >= 0 ? `-${delta.toFixed(1)}%` : `+${(-delta).toFixed(1)}%`;
    console.log(
      `SKIP (saving below ${MIN_SAVING_RATIO * 100}% threshold): ${filepath} ` +
      `(would be ${fmt(outputBuf.length)} vs original ${fmt(originalSize)}, ${change})`
    );
    return;
  }

  await writeFile(filepath, outputBuf);
  const savedPct = (100 - (100 * outputBuf.length) / originalSize).toFixed(0);
  console.log(
    `COMPRESS: ${filepath} ${fmt(originalSize)} -> ${fmt(outputBuf.length)} (-${savedPct}%)`
  );
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log('No files provided.');
    return;
  }

  console.log(`Processing ${files.length} image(s)...`);
  for (const f of files) {
    try {
      await processImage(f);
    } catch (e) {
      console.error(`ERROR ${f}: ${e.message}`);
    }
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  // Intentionally exit 0 even on unexpected errors — we don't want image
  // processing to block a deploy.
  process.exit(0);
});
