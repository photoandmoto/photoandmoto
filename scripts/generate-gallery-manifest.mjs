import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function generateManifest(gallerySlug) {
  const galleryDir = path.join(__dirname, `../public/galleries/${gallerySlug}`);
  const outputPath = path.join(__dirname, `../src/content/galleries/${gallerySlug}.json`);
  
  console.log(`\n📂 Scanning ${galleryDir}...`);
  
  try {
    const files = (await fs.readdir(galleryDir))
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort();
    
    if (files.length === 0) {
      console.error(`❌ No images found in ${galleryDir}`);
      process.exit(1);
    }
    
    console.log(`✓ Found ${files.length} images`);
    console.log(`📊 Getting image dimensions...`);
    
    const images = await Promise.all(
      files.map(async (filename, index) => {
        const filepath = path.join(galleryDir, filename);
        const metadata = await sharp(filepath).metadata();
        
        let width = metadata.width;
        let height = metadata.height;
        if (metadata.orientation && metadata.orientation >= 5) {
          [width, height] = [height, width];
        }
        
        process.stdout.write(`\r   Processing ${index + 1}/${files.length}...`);
        
        const caption = filename
          .replace(/\.(jpg|jpeg|png|webp)$/i, '')
          .replace(/_/g, ' ');
        
        return {
          filename,
          caption,
          photographer: 'Matti Tarkkonen',
          date: '',
          width,
          height,
        };
      })
    );
    
    console.log(`\r   ✓ Processed ${images.length} images           `);
    
    const manifest = {
      title: formatTitle(gallerySlug),
      slug: gallerySlug,
      description: `Photo gallery: ${formatTitle(gallerySlug)}`,
      cover_image: files[0],
      images,
      category: determineCategory(gallerySlug),
    };
    
    await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2));
    console.log(`\n✅ Generated ${outputPath}`);
    console.log(`   ${images.length} images indexed\n`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

function formatTitle(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function determineCategory(slug) {
  if (slug.includes('international')) return 'international';
  if (slug.includes('suomi') || slug.includes('finland')) return 'finland';
  if (slug.includes('enduro')) return 'enduro';
  if (slug.includes('scramble')) return 'scramble';
  if (slug.includes('black')) return 'black-white';
  return 'international';
}

const gallerySlug = process.argv[2];
if (!gallerySlug) {
  console.error('\nUsage: npm run generate-gallery <gallery-slug>\n');
  process.exit(1);
}
generateManifest(gallerySlug);