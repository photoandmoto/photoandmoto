// Scrapes the Hyvinkää Scramble 2026 entry list and appends an aggregate
// snapshot to public/data/scramble-2026.json. Two per day (09:00 and 21:00
// Helsinki), keyed on date + slot so each run can be compared against the one
// immediately before it.
//
// IMPORTANT — only counts are stored, never names.
// The source page lists ~100 real people, one of whom registered as
// "*** Salainen ***" precisely to avoid being named. This repo is public, so
// the roster must not land in it. Everything below reduces rows to numbers
// before anything is written to disk.
//
// Source markup (verified against the live page):
//   <table>
//     <caption><h1>Scramble A 1978 tai vanhempi</h1></caption>
//     <tbody>
//       <tr><th>Numero</th><th>Nimi</th><th>Pyörä</th><th>Vuosimalli</th></tr>
//       <tr><td>3</td><td>Jori Mäkipää</td><td>CZ 250</td><td>1972</td></tr>
// Trial and Mopottelu have no "Numero" column, so columns are located by their
// header text rather than by position.
//
// Run: node scripts/scrape-scramble.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const URL_SOURCE = 'https://www.scramble.fi/scramble-2026-ilmoittautuneet/';
const OUT = 'public/data/scramble-2026.json';

// ── Make normalisation ──────────────────────────────────────────────────────
// The "Pyörä" column is free text, so the same manufacturer appears several
// ways: HVA, Husgvarna (typo) and Husqvarna are all Husqvarna. Without this
// the counts fragment. Add new spellings here as they turn up.
const MAKE_ALIASES = {
  hva: 'Husqvarna',
  husqvarna: 'Husqvarna',
  husgvarna: 'Husqvarna',
  husquarna: 'Husqvarna',
  honda: 'Honda',
  yamaha: 'Yamaha',
  suzuki: 'Suzuki',
  kawasaki: 'Kawasaki',
  ktm: 'KTM',
  maico: 'Maico',
  bultaco: 'Bultaco',
  matchless: 'Matchless',
  rickman: 'Rickman',
  rikman: 'Rickman',
  bsa: 'BSA',
  cz: 'CZ',
  jawa: 'JAWA',
  swm: 'SWM',
  ome: 'OME',
  fantic: 'Fantic',
  gm: 'GM',
  montesa: 'Montesa',
  gasgas: 'GasGas',
  beta: 'Beta',
  aprilia: 'Aprilia',
  triumph: 'Triumph',
  bmw: 'BMW',
  puch: 'Puch',
  zundapp: 'Zündapp',
  solifer: 'Solifer',
};

function normaliseMake(bike) {
  const first = String(bike || '').trim().split(/[\s/,-]+/)[0].toLowerCase();
  if (!first) return null;
  if (MAKE_ALIASES[first]) return MAKE_ALIASES[first];
  // Unknown make: title-case it so it still counts, and so a new manufacturer
  // shows up in the output rather than being silently dropped.
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// ── Rider identity ──────────────────────────────────────────────────────────
// Used only to count distinct people, never stored. Sorting the name parts
// makes the key order-independent, so "Rahkonen Timo" and "Timo Rahkonen"
// collapse to one person — the entry list genuinely contains both spellings
// for the same rider.
function riderKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\*/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

// ── HTML parsing ────────────────────────────────────────────────────────────
const stripTags = (s) => String(s).replace(/<[^>]*>/g, '');

function decode(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .trim();
}

const cellText = (html) => decode(stripTags(html).replace(/\s+/g, ' '));

function parseTables(html) {
  const out = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  for (const [table] of html.matchAll(tableRe)) {
    const caption = table.match(/<caption[\s\S]*?<\/caption>/i);
    const className = caption ? cellText(caption[0]) : null;
    if (!className) continue;

    const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
    if (!rows.length) continue;

    // Header row locates the columns — Trial/Mopottelu have no Numero column.
    const headerCells = [...rows[0].matchAll(/<th[\s\S]*?<\/th>/gi)].map((m) =>
      cellText(m[0]).toLowerCase()
    );
    if (!headerCells.length) continue;
    const iName = headerCells.findIndex((h) => h.startsWith('nimi'));
    const iBike = headerCells.findIndex((h) => h.startsWith('pyör'));
    const iYear = headerCells.findIndex((h) => h.startsWith('vuosi'));

    const entries = [];
    for (const row of rows.slice(1)) {
      const tds = [...row.matchAll(/<td[\s\S]*?<\/td>/gi)].map((m) => cellText(m[0]));
      if (!tds.length) continue;
      const name = iName >= 0 ? tds[iName] : '';
      const bike = iBike >= 0 ? tds[iBike] : '';
      const yearRaw = iYear >= 0 ? tds[iYear] : '';
      if (!name && !bike) continue; // spacer row
      const year = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
      entries.push({ name, bike, year });
    }
    out.push({ className, entries });
  }
  return out;
}

// ── Aggregation ─────────────────────────────────────────────────────────────
function aggregate(tables) {
  const classes = [];
  const allMakes = {};
  const allYears = {};
  const riders = new Set();
  let totalEntries = 0;

  for (const { className, entries } of tables) {
    const makes = {};
    const years = {};
    for (const e of entries) {
      const make = normaliseMake(e.bike);
      if (make) {
        makes[make] = (makes[make] || 0) + 1;
        allMakes[make] = (allMakes[make] || 0) + 1;
      }
      if (e.year) {
        years[e.year] = (years[e.year] || 0) + 1;
        allYears[e.year] = (allYears[e.year] || 0) + 1;
      }
      const key = riderKey(e.name);
      if (key) riders.add(key);
    }
    totalEntries += entries.length;
    classes.push({ name: className, entries: entries.length, makes, years });
  }

  return {
    entries: totalEntries,
    uniqueRiders: riders.size,
    classes,
    makes: allMakes,
    years: allYears,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const res = await fetch(URL_SOURCE, {
    headers: {
      'User-Agent':
        'photoandmoto.fi entry-stats bot (+https://www.photoandmoto.fi/fi/scramble-2026)',
    },
  });
  if (!res.ok) throw new Error(`Source returned ${res.status}`);
  const html = await res.text();

  const tables = parseTables(html);
  if (!tables.length) throw new Error('No entry tables found — page markup may have changed');

  const snapshot = aggregate(tables);

  // Two snapshots a day are kept, not one. Keying on the date alone meant the
  // 21:00 run overwrote the 09:00 one, so the page could only ever compare
  // "latest today" against "latest yesterday" — the morning figures vanished
  // and the interval silently alternated between 12 and 24 hours.
  // Keying on date + slot keeps both, so each run is compared against the one
  // immediately before it.
  const now = new Date();
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Helsinki', hour: '2-digit', hour12: false,
    }).format(now)
  );
  // A manual run lands in whichever half of the day it falls in, replacing that
  // slot rather than adding a third point and skewing the deltas.
  const slot = hour < 12 ? 'aamu' : 'ilta';

  let data = { source: URL_SOURCE, event: 'Hyvinkää Scramble & Trial 2026', snapshots: [] };
  try {
    data = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    /* first run */
  }
  if (!Array.isArray(data.snapshots)) data.snapshots = [];

  // Re-running the same slot replaces it rather than adding a duplicate.
  data.snapshots = data.snapshots.filter((s) => !(s.date === date && s.slot === slot));
  data.snapshots.push({ date, slot, at: now.toISOString(), ...snapshot });
  data.snapshots.sort((a, b) =>
    a.date === b.date ? (a.slot === b.slot ? 0 : a.slot === 'aamu' ? -1 : 1)
                      : a.date.localeCompare(b.date)
  );
  data.updated = new Date().toISOString();

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');

  console.log(`${date} ${slot}: ${snapshot.entries} entries, ${snapshot.uniqueRiders} riders, ` +
    `${snapshot.classes.length} classes, ${Object.keys(snapshot.makes).length} makes`);
  for (const c of snapshot.classes) console.log(`  ${c.name}: ${c.entries}`);
}

main().catch((err) => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
