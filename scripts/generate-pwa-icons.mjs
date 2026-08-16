import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '../public/images/logo.png');
const outDir = path.join(__dirname, '../public/icons');

for (const size of [192, 512]) {
  await sharp(src)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .png()
    .toFile(path.join(outDir, `icon-${size}x${size}.png`));
  console.log(`icon-${size}x${size}.png`);
}
