import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const THUMB_WIDTH = 600;
const DISPLAY_WIDTH = 1400;
const WATERMARK_TEXT = '© Photo & Moto';

// =============================================================================
// Shared image processing helpers (used by both full-rebuild and --add modes)
// =============================================================================

async function processOneImage(galleryDir, filename) {
  const filepath = path.join(galleryDir, filename);
  const thumbDir = path.join(galleryDir, 'thumbs');
  const displayDir = path.join(galleryDir, 'display');

  await fs.mkdir(thumbDir, { recursive: true });
  await fs.mkdir(displayDir, { recursive: true });

  // Generate thumbnail (600px, no watermark)
  const thumbName = filename.replace(/\.(jpg|jpeg|png|webp)$/i, '_thumb.jpg');
  await sharp(filepath)
    .rotate()
    .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(path.join(thumbDir, thumbName));

  // Generate display version (1400px, with watermark)
  const displayName = filename.replace(/\.(jpg|jpeg|png|webp)$/i, '_display.jpg');

  const resized = sharp(filepath)
    .rotate()
    .resize(DISPLAY_WIDTH, null, { withoutEnlargement: true });

  const resizedBuffer = await resized.clone().toBuffer();
  const actualMeta = await sharp(resizedBuffer).metadata();
  const actualW = actualMeta.width;
  const actualH = actualMeta.height;

  const wmFontSize = Math.round(actualW * 0.025);
  const wmPadding = Math.round(wmFontSize * 0.8);
  const wmSvg = Buffer.from(`<svg width="${actualW}" height="${actualH}">
    <style>
      .wm {
        fill: rgba(255,255,255,0.5);
        font-size: ${wmFontSize}px;
        font-family: Arial, sans-serif;
        font-weight: bold;
      }
    </style>
    <text x="${actualW - wmPadding}" y="${actualH - wmPadding}" text-anchor="end" class="wm">${WATERMARK_TEXT}</text>
  </svg>`);

  await sharp(resizedBuffer)
    .composite([{ input: wmSvg, gravity: 'southeast' }])
    .jpeg({ quality: 85 })
    .toFile(path.join(displayDir, displayName));

  const caption = filename
    .replace(/\.(jpg|jpeg|png|webp)$/i, '')
    .replace(/_/g, ' ');

  return {
    filename,
    thumb: `thumbs/${thumbName}`,
    display: `display/${displayName}`,
    caption,
    photographer: '',
    date: '',
    width: actualW,
    height: actualH,
  };
}

function formatTitle(slug) {
  const romanNumerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
  return slug.split('-').map(w => {
    if (romanNumerals.includes(w.toLowerCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function determineCategory(slug) {
  if (slug.includes('international')) return 'international';
  if (slug.includes('suomi') || slug.includes('finland')) return 'finland';
  if (slug.includes('enduro')) return 'enduro';
  if (slug.includes('scramble')) return 'scramble';
  if (slug.includes('black')) return 'black-white';
  return 'international';
}

function extractYearFromCaption(text) {
  if (!text) return null;
  const fourDigit = text.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  if (fourDigit) return parseInt(fourDigit[1]);
  const twoDigit = text.match(/[-_\s](5[0-9]|6[0-9]|7[0-9]|8[0-9]|9[0-9])(?:\b|[-_\s\.])/);
  if (twoDigit) {
    const num = parseInt(twoDigit[1]);
    return num >= 50 ? 1900 + num : 2000 + num;
  }
  return null;
}

function sortImages(images) {
  return [...images].sort((a, b) => {
    const yearA = extractYearFromCaption(a.caption || a.filename);
    const yearB = extractYearFromCaption(b.caption || b.filename);
    if (yearA && yearB) {
      if (yearA !== yearB) return yearA - yearB;
      return (a.caption || '').localeCompare(b.caption || '', 'fi');
    }
    if (yearA && !yearB) return -1;
    if (!yearA && yearB) return 1;
    return (a.caption || '').localeCompare(b.caption || '', 'fi');
  });
}

// =============================================================================
// MODE 1: Full rebuild (existing behavior, unchanged from previous version)
// Usage: npm run generate-gallery <gallery-slug>
// =============================================================================

async function generateManifest(gallerySlug) {
  const galleryDir = path.join(__dirname, `../public/galleries/${gallerySlug}`);
  const outputPath = path.join(__dirname, `../src/content/galleries/${gallerySlug}.json`);

  console.log(`\n📂 Scanning ${galleryDir}...`);

  try {
    const allFiles = await fs.readdir(galleryDir);
    const files = allFiles
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort();

    if (files.length === 0) {
      console.error(`❌ No images found in ${galleryDir}`);
      process.exit(1);
    }

    console.log(`✓ Found ${files.length} images`);
    console.log(`📝 Generating thumbnails + display images with watermark...`);

    const images = [];

    for (let i = 0; i < files.length; i++) {
      const entry = await processOneImage(galleryDir, files[i]);
      images.push(entry);
      process.stdout.write(`\r   ${i + 1}/${files.length} processed...`);
    }

    console.log(`\r   ✓ ${images.length} images processed               `);
    console.log(`   ✓ Thumbnails (${THUMB_WIDTH}px) → ${path.join(galleryDir, 'thumbs')}`);
    console.log(`   ✓ Display (${DISPLAY_WIDTH}px + watermark) → ${path.join(galleryDir, 'display')}`);

    const sortedImages = sortImages(images);

    const manifest = {
      title: formatTitle(gallerySlug),
      slug: gallerySlug,
      description: `Photo gallery: ${formatTitle(gallerySlug)}`,
      cover_image: `thumbs/${files[0].replace(/\.(jpg|jpeg|png|webp)$/i, '_thumb.jpg')}`,
      images: sortedImages,
      category: determineCategory(gallerySlug),
    };

    await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2));
    console.log(`\n✅ Gallery "${manifest.title}" ready!`);
    console.log(`   ${images.length} images indexed`);
    console.log(`\n💡 You can now delete the original large files from:`);
    console.log(`   ${galleryDir}/*.jpg`);
    console.log(`   (Keep the thumbs/ and display/ folders)\n`);

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// =============================================================================
// MODE 2: --add (incremental, used by GitHub Action after publish endpoint commits)
// Usage: npm run generate-gallery <gallery-slug> --add <filename>
// Behavior: process ONE file, append to existing manifest, do not touch other entries
// If manifest doesn't exist yet, creates a new one with this single image
// =============================================================================

async function addSingleImage(gallerySlug, filename) {
  const galleryDir = path.join(__dirname, `../public/galleries/${gallerySlug}`);
  const outputPath = path.join(__dirname, `../src/content/galleries/${gallerySlug}.json`);

  console.log(`\n📂 Adding ${filename} to ${gallerySlug}...`);

  try {
    // Verify the source image exists
    const filepath = path.join(galleryDir, filename);
    try {
      await fs.access(filepath);
    } catch {
      console.error(`❌ Source image not found: ${filepath}`);
      process.exit(1);
    }

    // Process the new image (Sharp transforms + watermark)
    console.log(`📝 Generating thumbnail + display with watermark...`);
    const newEntry = await processOneImage(galleryDir, filename);
    console.log(`   ✓ Thumbnail: ${newEntry.thumb}`);
    console.log(`   ✓ Display:   ${newEntry.display}`);
    console.log(`   ✓ Dimensions: ${newEntry.width}x${newEntry.height}`);

    // Load existing manifest, or build a fresh one if this is gallery's first image
    let manifest;
    let isNewGallery = false;
    try {
      const existing = await fs.readFile(outputPath, 'utf8');
      manifest = JSON.parse(existing);
      console.log(`   ✓ Loaded existing manifest (${manifest.images.length} images)`);
    } catch {
      isNewGallery = true;
      console.log(`   ✓ No existing manifest — creating new gallery`);
      manifest = {
        title: formatTitle(gallerySlug),
        slug: gallerySlug,
        description: `Photo gallery: ${formatTitle(gallerySlug)}`,
        cover_image: newEntry.thumb,
        images: [],
        category: determineCategory(gallerySlug),
      };
    }

    // Skip if this exact filename is already in the manifest (idempotent re-runs)
    const alreadyExists = manifest.images.some(img => img.filename === filename);
    if (alreadyExists) {
      console.log(`\n⚠️  Image already in manifest — replacing entry to refresh dimensions`);
      manifest.images = manifest.images.filter(img => img.filename !== filename);
    }

    manifest.images.push(newEntry);
    manifest.images = sortImages(manifest.images);

    // Refresh cover_image only if this is a brand new gallery
    if (isNewGallery) {
      manifest.cover_image = newEntry.thumb;
    }

    await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2));

    console.log(`\n✅ Added "${filename}" to "${manifest.title}"`);
    console.log(`   Total images now: ${manifest.images.length}\n`);

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// =============================================================================
// CLI dispatcher
// =============================================================================

const args = process.argv.slice(2);
const gallerySlug = args[0];
const addFlagIndex = args.indexOf('--add');
const addFile = addFlagIndex !== -1 ? args[addFlagIndex + 1] : null;

if (!gallerySlug) {
  console.error('\nUsage:');
  console.error('  npm run generate-gallery <gallery-slug>                  (full rebuild)');
  console.error('  npm run generate-gallery <gallery-slug> --add <filename> (add single image)\n');
  process.exit(1);
}

if (addFile) {
  addSingleImage(gallerySlug, addFile);
} else {
  generateManifest(gallerySlug);
}
