import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const THUMB_WIDTH = 600;
const DISPLAY_WIDTH = 1400;
const WATERMARK_TEXT = '© Photo & Moto';

async function generateManifest(gallerySlug) {
  const galleryDir = path.join(__dirname, `../public/galleries/${gallerySlug}`);
  const thumbDir = path.join(galleryDir, 'thumbs');
  const displayDir = path.join(galleryDir, 'display');
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
    
    await fs.mkdir(thumbDir, { recursive: true });
    await fs.mkdir(displayDir, { recursive: true });
    
    console.log(`📐 Generating thumbnails + display images with watermark...`);
    
    const images = [];
    
    for (let i = 0; i < files.length; i++) {
      const filename = files[i];
      const filepath = path.join(galleryDir, filename);
      const metadata = await sharp(filepath).metadata();
      
      // Fix EXIF orientation
      let width = metadata.width;
      let height = metadata.height;
      if (metadata.orientation && metadata.orientation >= 5) {
        [width, height] = [height, width];
      }
      
      // Generate thumbnail (600px, no watermark)
      const thumbName = filename.replace(/\.(jpg|jpeg|png|webp)$/i, '_thumb.jpg');
      await sharp(filepath)
        .rotate()
        .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(path.join(thumbDir, thumbName));
      
      // Generate display version (1400px, with watermark)
      const displayName = filename.replace(/\.(jpg|jpeg|png|webp)$/i, '_display.jpg');
      
      // First resize to get actual dimensions
      const resized = sharp(filepath)
        .rotate()
        .resize(DISPLAY_WIDTH, null, { withoutEnlargement: true });
      
      const resizedMeta = await resized.clone().metadata();
      // After rotate+resize, get real dimensions
      const resizedBuffer = await resized.clone().toBuffer();
      const actualMeta = await sharp(resizedBuffer).metadata();
      const actualW = actualMeta.width;
      const actualH = actualMeta.height;
      
      // Create watermark SVG matching actual dimensions
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
      
      images.push({
        filename,
        thumb: `thumbs/${thumbName}`,
        display: `display/${displayName}`,
        caption,
        photographer: 'Matti Tarkkonen',
        date: '',
        width: actualW,
        height: actualH,
      });
      
      process.stdout.write(`\r   ${i + 1}/${files.length} processed...`);
    }
    
    console.log(`\r   ✓ ${images.length} images processed               `);
    console.log(`   ✓ Thumbnails (${THUMB_WIDTH}px) → ${thumbDir}`);
    console.log(`   ✓ Display (${DISPLAY_WIDTH}px + watermark) → ${displayDir}`);
    
    // Sort images: by year ascending, then alphabetical, no-year at end
    images.sort((a, b) => {
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

    const manifest = {
      title: formatTitle(gallerySlug),
      slug: gallerySlug,
      description: `Photo gallery: ${formatTitle(gallerySlug)}`,
      cover_image: `thumbs/${files[0].replace(/\.(jpg|jpeg|png|webp)$/i, '_thumb.jpg')}`,
      images,
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

const gallerySlug = process.argv[2];
if (!gallerySlug) {
  console.error('\nUsage: npm run generate-gallery <gallery-slug>\n');
  process.exit(1);
}
generateManifest(gallerySlug);
