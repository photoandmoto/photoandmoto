import fs from 'fs';
import path from 'path';

const gallerySlug = process.argv[2];
if (!gallerySlug) {
  console.log('Usage: node scripts/rebuild-gallery-json.mjs <gallery-slug>');
  process.exit(1);
}

const galleryDir = path.join('public', 'galleries', gallerySlug);
const thumbsDir = path.join(galleryDir, 'thumbs');
const displayDir = path.join(galleryDir, 'display');

if (!fs.existsSync(thumbsDir)) {
  console.log('No thumbs/ folder found in ' + galleryDir);
  process.exit(1);
}

const romanNumerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
function formatTitle(slug) {
  return slug.split('-').map(w => {
    if (romanNumerals.includes(w.toLowerCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

const thumbFiles = fs.readdirSync(thumbsDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort();

const images = thumbFiles.map(thumbFile => {
  const displayFile = thumbFile.replace(/\.(jpg|jpeg|png|webp)$/i, '_display.jpg');
  const caption = thumbFile
    .replace(/\.(jpg|jpeg|png|webp)$/i, '')
    .replace(/_thumb$/, '')
    .replace(/_/g, ' ');

  return {
    filename: thumbFile,
    thumb: 'thumbs/' + thumbFile,
    display: fs.existsSync(path.join(displayDir, displayFile)) ? 'display/' + displayFile : 'thumbs/' + thumbFile,
    caption: caption,
    photographer: 'Matti Tarkkonen',
    date: '',
    width: 1400,
    height: 1000,
  };
});

const title = formatTitle(gallerySlug);
const manifest = {
  title: title,
  slug: gallerySlug,
  description: 'Photo gallery: ' + title,
  cover_image: images[0]?.thumb || '',
  images: images,
};

const jsonDir = path.join('src', 'content', 'galleries');
if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });

const jsonPath = path.join(jsonDir, gallerySlug + '.json');
fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2));

console.log('Rebuilt ' + jsonPath);
console.log(images.length + ' images indexed');