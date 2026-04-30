// fix-phase-d.cjs — run from project root: node fix-phase-d.cjs
const fs = require('fs');

// ── Fix 1: encoding in gallery-manage.js ─────────────────────────────────
let gm = fs.readFileSync('functions/api/mystery/gallery-manage.js', 'utf8');

const OLD_DECODE = `  const decoded = atob(content);\n  return JSON.parse(decoded);`;
const NEW_DECODE = `  const bytes = base64ToBytes(content);\n  const decoded = new TextDecoder('utf-8').decode(bytes);\n  return JSON.parse(decoded);`;

if (gm.includes(OLD_DECODE)) {
  gm = gm.replace(OLD_DECODE, NEW_DECODE);
  fs.writeFileSync('functions/api/mystery/gallery-manage.js', gm, 'utf8');
  console.log('✓ Fixed UTF-8 encoding in gallery-manage.js');
} else {
  console.log('· Encoding fix already applied or string not found');
}

// ── Fix 2: add missing CSS to tunnistamatta.astro ────────────────────────
let astro = fs.readFileSync('src/pages/fi/tunnistamatta.astro', 'utf8');

const CSS = `
  /* ===== HALLITSE GALLERIAA ===== */
  .hallitse-section{max-width:960px}
  .hallitse-top{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:8px}
  .hallitse-select-row{display:flex;gap:10px;align-items:center}
  .hallitse-gallery-actions{display:flex;gap:8px;align-items:center}
  .hallitse-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:16px}
  .hcard{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .hcard-img{aspect-ratio:4/3;overflow:hidden;background:#1a1a1a}
  .hcard-img img{width:100%;height:100%;object-fit:cover;display:block}
  .hcard-caption{font-size:.72rem;color:#555;padding:8px 10px;line-height:1.3;min-height:36px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hcard-actions{display:flex;gap:6px;padding:0 10px 10px}
  .hcard-actions .btn{font-size:.72rem;padding:6px 10px;flex:1}
  @media(max-width:900px){.hallitse-grid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:540px){.hallitse-grid{grid-template-columns:1fr}}
`;

if (!astro.includes('.hallitse-grid{display:grid')) {
  astro = astro.replace('</style>', CSS + '\n</style>');
  fs.writeFileSync('src/pages/fi/tunnistamatta.astro', astro, 'utf8');
  console.log('✓ Added Hallitse CSS to tunnistamatta.astro');
} else {
  console.log('· CSS already present');
}

console.log('\n✅ Done.');
