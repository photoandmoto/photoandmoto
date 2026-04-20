// Re-sorts images in all existing gallery JSON files
// Sort logic: by year (ascending), then alphabetical, no-year at end

import fs from 'fs';
import path from 'path';

const galleriesDir = 'src/content/galleries';

function extractYear(text) {
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
  return images.sort((a, b) => {
    const yearA = extractYear(a.caption || a.filename);
    const yearB = extractYear(b.caption || b.filename);
    
    // Both have years → sort by year
    if (yearA && yearB) {
      if (yearA !== yearB) return yearA - yearB;
      // Same year → alphabetical
      return (a.caption || '').localeCompare(b.caption || '', 'fi');
    }
    
    // One has year, other doesn't → year first
    if (yearA && !yearB) return -1;
    if (!yearA && yearB) return 1;
    
    // Neither has year → alphabetical
    return (a.caption || '').localeCompare(b.caption || '', 'fi');
  });
}

const files = fs.readdirSync(galleriesDir).filter(f => f.endsWith('.json'));

files.forEach(f => {
  const filePath = path.join(galleriesDir, f);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  
  const before = data.images.map(i => i.caption || i.filename).join('|');
  data.images = sortImages(data.images);
  const after = data.images.map(i => i.caption || i.filename).join('|');
  
  const changed = before !== after;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  
  // Show first few and year range
  const years = data.images.map(i => extractYear(i.caption || i.filename)).filter(Boolean);
  const minYear = years.length ? Math.min(...years) : '-';
  const maxYear = years.length ? Math.max(...years) : '-';
  const noYear = data.images.length - years.length;
  
  console.log(`${changed ? '✅' : '⬜'} ${f}: ${data.images.length} images | ${minYear}-${maxYear} | ${noYear} without year`);
});

console.log('\nDone! All galleries sorted by year → alphabetical');
