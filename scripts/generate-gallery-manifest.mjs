import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function generateManifest(gallerySlug) {
  const galleryDir = path.join(__dirname, `../src/assets/galleries/${gallerySlug}`);
  const outputPath = path.join(__dirname, `../src/content/galleries/${gallerySlug}.json`);
  
  console.log(`\n📂 Scanning ${galleryDir}...`);
  
  try {
    // Read all image files
    const files = (await fs.readdir(galleryDir))
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort();
    
    if (files.length === 0) {
      console.error(`❌ No images found in ${galleryDir}`);
      console.error(`   Please add some .jpg, .png, or .webp files first.`);
      process.exit(1);
    }
    
    console.log(`✓ Found ${files.length} images`);
    console.log(`📊 Getting image dimensions...`);
    
    // Get metadata for each image
    const images = await Promise.all(
      files.map(async (filename, index) => {
        const filepath = path.join(galleryDir, filename);
        const metadata = await sharp(filepath).metadata();
        
        process.stdout.write(`\r   Processing ${index + 1}/${files.length}...`);
        
        return {
          filename,
          caption: '',
          photographer: 'Matti Tarkkonen',
          date: '',
          width: metadata.width,
          height: metadata.height,
        };
      })
    );
    
    console.log(`\r   ✓ Processed ${images.length} images           `);
    
    // Create manifest
    const manifest = {
      title: formatTitle(gallerySlug),
      slug: gallerySlug,
      description: `Photo gallery: ${formatTitle(gallerySlug)}`,
      cover_image: files[0],
      images,
      category: determineCategory(gallerySlug),
    };
    
    // Write to file
    await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2));
    console.log(`\n✅ Generated ${outputPath}`);
    console.log(`   ${images.length} images indexed`);
    console.log(`\n🎉 Gallery "${manifest.title}" is ready!`);
    console.log(`   Preview at: http://localhost:4321/fi/galleria/${gallerySlug}\n`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

function formatTitle(slug) {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function determineCategory(slug) {
  if (slug.includes('international')) return 'international';
  if (slug.includes('suomi') || slug.includes('finland')) return 'finland';
  if (slug.includes('enduro')) return 'enduro';
  if (slug.includes('scramble')) return 'scramble';
  if (slug.includes('black')) return 'black-white';
  return 'international';
}

// CLI
const gallerySlug = process.argv[2];

if (!gallerySlug) {
  console.error('\n❌ Error: Gallery slug required');
  console.error('\nUsage:');
  console.error('  npm run generate-gallery <gallery-slug>');
  console.error('\nExample:');
  console.error('  npm run generate-gallery international-i');
  console.error('\nAvailable galleries:');
  console.error('  - international-i, international-ii, international-iii');
  console.error('  - suomi-i, suomi-ii');
  console.error('  - enduro, scramble, black-white\n');
  process.exit(1);
}

generateManifest(gallerySlug);
