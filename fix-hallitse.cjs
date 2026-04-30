const fs = require('fs');
let c = fs.readFileSync('src/pages/fi/tunnistamatta.astro', 'utf8');
const old = "if(tab==='hallitse' && adminPw && !document.getElementById('hallitseGallerySelect').options.length>1){loadHallitseGalleries();}";
const fix = "if(tab==='hallitse' && adminPw){loadHallitseGalleries();}";
if (c.includes(old)) {
  c = c.replace(old, fix);
  fs.writeFileSync('src/pages/fi/tunnistamatta.astro', c, 'utf8');
  console.log('Fixed');
} else {
  console.log('String not found — already fixed or different');
}
