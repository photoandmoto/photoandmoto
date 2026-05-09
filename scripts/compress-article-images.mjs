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
//       PNG  -> compression 9 + palette
//       WebP -> quality 82
//   - Skip the write if the new buffer is bigger than the original
//     (avoids enlarging tiny already-optimized files)
//
// Exit codes: 0 always (we don't fail the push for image issues).

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 82;
const SKIP_SIZE_BYTES = 200 * 1024; // 200 KB

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
    outputBuf = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
  } else if (ext === '.webp') {
    outputBuf = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
  }

  if (outputBuf.length >= originalSize) {
    console.log(
      `SKIP (no improvement): ${filepath} ` +
      `(would be ${fmt(outputBuf.length)} vs original ${fmt(originalSize)})`
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
