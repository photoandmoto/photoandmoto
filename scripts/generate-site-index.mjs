import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const index = [];

// 1. Articles
const articlesDir = path.join(ROOT, 'src/content/articles/fi');
if (fs.existsSync(articlesDir)) {
  const files = fs.readdirSync(articlesDir).filter(f => f.endsWith('.md'));
  files.forEach(f => {
    const content = fs.readFileSync(path.join(articlesDir, f), 'utf-8');
    const parts = content.split('---');
    if (parts.length >= 3) {
      const body = parts.slice(2).join('---').trim();
      let title = '';
      parts[1].split('\n').forEach(line => {
        if (line.startsWith('title:')) title = line.split(':').slice(1).join(':').trim().replace(/^"|"$/g, '');
      });
      index.push({ type: 'article', title, content: body.substring(0, 3000) });
    }
  });
}

// 2. Champions data
const champFile = path.join(ROOT, 'public/data/champions.json');
if (fs.existsSync(champFile)) {
  const champ = JSON.parse(fs.readFileSync(champFile, 'utf-8'));

  // FIM
  const fimLines = champ.fim.map(e => {
    const parts = Object.entries(e).filter(([k]) => k !== 'year').map(([k, v]) => `${k}=${v}`);
    return `${e.year}: ${parts.join(', ')}`;
  });
  index.push({ type: 'stats', title: 'FIM World Champions 1957-2025', content: fimLines.join('\n') });

  // SM - complete
  const smLines = [];
  (champ.sml_full || []).forEach(e => {
    [1, 2, 3].forEach(pos => {
      const p = e[`pos${pos}`];
      if (p) {
        const entries = Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
        if (entries.length) smLines.push(`${e.year} sija ${pos}: ${entries.join(', ')}`);
      }
    });
  });
  index.push({ type: 'stats', title: 'Suomen mestarit (SM) 1954-2025 - kaikki sijat ja luokat', content: smLines.join('\n') });

  // MXdN
  const mxdnLines = champ.mxdn.map(e => `${e.year}: ${e.country} (${e.riders})`);
  index.push({ type: 'stats', title: 'Motocross des Nations 1947-2024', content: mxdnLines.join('\n') });

  // AMA
  const amaLines = champ.ama.map(e => {
    const parts = Object.entries(e).filter(([k]) => k !== 'year').map(([k, v]) => `${k}=${v}`);
    return `${e.year}: ${parts.join(', ')}`;
  });
  index.push({ type: 'stats', title: 'AMA Champions 1972-2025', content: amaLines.join('\n') });

  // Trans-AMA
  const xamaLines = champ.xama.map(e => `${e.year}: ${e.series} - ${e.rider} (${e.country}, ${e.bike})`);
  index.push({ type: 'stats', title: 'Trans-AMA Champions', content: xamaLines.join('\n') });
}

// 3. Calendar
const calFile = path.join(ROOT, 'public/data/calendar.json');
if (fs.existsSync(calFile)) {
  const cal = JSON.parse(fs.readFileSync(calFile, 'utf-8'));
  const calLines = cal.map(e => `${e.date}: ${e.title} @ ${e.location} (${e.category})`);
  index.push({ type: 'calendar', title: 'Kilpailukalenteri 2026', content: calLines.join('\n') });
}

// 4. Galleries
const galDir = path.join(ROOT, 'src/content/galleries');
if (fs.existsSync(galDir)) {
  fs.readdirSync(galDir).filter(f => f.endsWith('.json')).forEach(f => {
    const g = JSON.parse(fs.readFileSync(path.join(galDir, f), 'utf-8'));
    index.push({ type: 'gallery', title: g.title || '', content: `Gallery: ${g.title || ''} - ${(g.images || []).length} photos` });
  });
}

// Save
const outFile = path.join(ROOT, 'public/data/site-index.json');
fs.writeFileSync(outFile, JSON.stringify(index, null, 0), 'utf-8');

const total = JSON.stringify(index).length;
console.log(`\n✅ Site index generated!`);
console.log(`   ${index.length} entries | ${total} chars (~${Math.round(total/4)} tokens)`);
index.forEach(i => console.log(`   ${i.type.padEnd(10)} | ${i.title.substring(0, 55)}`));
console.log(`\n   Saved to: ${outFile}`);
