// POST /api/generate-article
//
// Pikauutinen two-step flow — step 1: generate a draft via Gemini.
// Returns { ok, title, body } only — NO GitHub commit, NO D1, NO email.
// Step 2 (commit + audit + email) is handled by /api/submit-pikauutinen.

import { requireAuth, getClientIp } from '../_lib/auth.js';

const GEMINI_MODEL = 'gemini-2.5-flash';
const TITLE_MAX = 80;
const BODY_MAX = 500;

const CATEGORY_LABELS = {
  Enduro: 'Enduro',
  Interview: 'Haastattelu',
  Profile: 'Henkilökuva',
  Historical: 'Historiallinen',
  'Ice speedway': 'Ice speedway',
  'Long Track': 'Maarata',
  Motocross: 'Motocross',
  MXGP: 'MXGP',
  Scramble: 'Scramble',
  Speedway: 'Speedway',
  Technical: 'Tekninen',
  Trail: 'Trail',
};
const ALLOWED_CATEGORIES = Object.keys(CATEGORY_LABELS);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const ok = (d) => json({ ok: true, ...d });
const fail = (msg, status = 400) => json({ ok: false, error: msg }, status);

// ---------------------------------------------------------------------------
// Rate limit — max 50 per IP per hour (in-memory, Worker-level).
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 50;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map();
function checkRateLimit(ip, now) {
  const recent = (rateBuckets.get(ip) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  if (rateBuckets.size > 500) {
    for (const [k, v] of rateBuckets) {
      const f = v.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
      if (f.length) rateBuckets.set(k, f); else rateBuckets.delete(k);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------
function buildPrompt(f) {
  return `Olet kokenut suomalainen moottoriurheilutoimittaja, joka kirjoittaa
photoandmoto.fi-sivustolle. Tehtäväsi on muuntaa alla olevat
ranskalaisin viivoin annetut tiedot sujuvaksi, ammattimaiseksi
pikauutiseksi — kuin kokenut sanomalehtitoimittaja sen kirjoittaisi.

═══ LÄHDETIEDOT ═══
Aihe: ${f.aihe}
Kategoria: ${f.category}
Päivämäärä: ${f.paivays}
Paikka: ${f.paikka}
Sää: ${f.saa || 'ei tietoa'}
Positiiviset tapahtumat: ${f.positiiviset}
Negatiiviset tapahtumat: ${f.negatiiviset || 'ei tietoa'}
Tulokset: ${f.tulokset}
Muuta: ${f.muuta || 'ei tietoa'}

═══ KIRJOITUSOHJEET ═══
1. KÄYTÄ VAIN annettuja tietoja. ÄLÄ KOSKAAN keksi nimiä, tuloksia,
   numeroita, tapahtumia tai yksityiskohtia, joita ei ole annettu.
   Jos jokin kenttä on "ei tietoa", älä mainitse sitä äläkä keksi
   sisältöä sen tilalle.
   Jos lähdetiedot ovat niukat, kirjoita vain siitä mitä tiedetään.
   Älä täytä aukkoja keksityillä yksityiskohdilla.
   ÄLÄ KOSKAAN keksi syytä keskeyttämiselle tai kaatumiselle.
   Jos lähdetiedoissa sanotaan 'kaatui', kirjoita 'kaatui'.
   Jos syy ei ole tiedossa, älä mainitse sitä.
   ÄLÄ KOSKAAN keksi tai viittaa henkilöiden tekemisiin,
   onnettomuuksiin, sairaustapauksiin, vammautumisiin,
   päihteidenkäyttöön tai muihin henkilökohtaisiin tapahtumiin,
   joita ei ole annettu lähdetiedoissa. Tällainen sisältö voi olla
   loukkaavaa, herjaavaa tai vaarallista. Jos lähdetiedoissa ei mainita
   mitään erityistä tapahtumaa, älä keksi sellaista.
   Jos negatiivisia tapahtumia on annettu, sisällytä ne tekstiin
   TÄSMÄLLEEN annettujen tietojen mukaisesti ja luontevasti
   tarinan osana. Älä lisää, muuta tai jätä pois mitään.
   Esimerkiksi jos annettu tieto on 'kaatui', kirjoita 'kaatui' —
   ei 'loukkaantui', 'joutui sairaalahoitoon' tai muuta.

2. Muunna ranskalaiset viivat luontevaksi, virtaavaksi
   uutistekstiksi. Älä luettele tietoja — kerro tarina kuten
   ammattitoimittaja: aloita tärkeimmästä, sido faktat yhteen
   sujuviksi virkkeiksi.

3. SISÄLLYTÄ TULOKSET tekstiin luonnollisesti (esim. kärkikolmikko).

4. SUOMEN KIELI: käytä virheetöntä suomea ja oikeita sijamuotoja.
   Henkilönnimet taivutetaan oikein:
   - "jätti Nicke Bomin taakseen" (EI "Nicke Bom")
   - "Niemisen vauhti riitti" (EI "Nieminen vauhti")
   Tarkista genetiivi, partitiivi ja muut sijamuodot huolellisesti.

5. SÄVY kategorian mukaan:
   - Kilpailuraportti / MXGP: napakka, faktapohjainen uutissävy
   - Historiallinen: kunnioittava, taustoittava
   - Haastattelu: henkilökeskeinen
   Pidä sävy asiallisena. Vältä liiallista värittämistä tai
   omia mielipiteitä — raportoi, älä kommentoi.

6. PITUUS: tiivis, 2-4 virkettä, korkeintaan 450 merkkiä.
   Mahduta kaikki oleellinen tähän tilaan. Älä katkaise kesken.

7. Teksti on pelkkää leipätekstiä — ÄLÄ käytä väliotsikoita,
   ranskalaisia viivoja tai Markdown-muotoilua bodyssä.

8. OIKOLUKU: Tarkista ja korjaa ilmeiset suomen kielen
   kirjoitusvirheet ennen vastauksen palauttamista.

═══ OTSIKKO ═══
- Korkeintaan 80 merkkiä
- Ytimekäs ja informatiivinen — kertoo uutisen ytimen
- Sisällytä paikka tai päähenkilö jos se on olennaista

═══ PALAUTUSMUOTO ═══
Palauta AINOASTAAN validi JSON, ei mitään muuta tekstiä:
{
  "title": "",
  "body": ""
}`;
}

async function callGemini(apiKey, prompt, attempt = 0) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.6, responseMimeType: 'application/json' },
        thinkingConfig: { thinkingBudget: 0 },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const text = await resp.text();
  if (!resp.ok) {
    console.error(`Gemini HTTP ${resp.status} headers:`, Object.fromEntries(resp.headers.entries()), 'body:', text);
    if (resp.status === 503 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1000));
      return callGemini(apiKey, prompt, 1);
    }
    const err = new Error(`Gemini ${resp.status}: ${text.slice(0, 500)}`);
    err.geminiStatus = resp.status;
    throw err;
  }
  const data = JSON.parse(text);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const out = (parts.find(p => !p.thought) ?? parts[0])?.text;
  if (!out) throw new Error('Gemini palautti tyhjän vastauksen');
  console.log('GEMINI_RAW:', out?.substring(0, 500));
  return out;
}

function parseGeminiJson(raw) {
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

function clamp(str, max) {
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastPeriod = cut.lastIndexOf('.');
  return lastPeriod > max * 0.5 ? cut.slice(0, lastPeriod + 1) : cut.trim();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuth(request, env, 'laheta_artikkeli');
    if (auth.error) return fail(auth.error, auth.status);

    if (!env.GEMINI_API_KEY) return fail('Tekoälypalvelua ei ole määritetty (GEMINI_API_KEY)', 500);

    const ip = getClientIp(request) || 'unknown';
    if (!checkRateLimit(ip, Date.now())) {
      return fail('Liian monta pikauutista tunnissa (enintään 50). Yritä myöhemmin uudelleen.', 429);
    }

    let form;
    try { form = await request.formData(); } catch { return fail('Virheellinen lomakedata', 400); }

    const aihe = (form.get('aihe') || '').toString().trim();
    const category = (form.get('category') || '').toString().trim();
    const paivays = (form.get('paivays') || '').toString().trim();
    const paikka = (form.get('paikka') || '').toString().trim();
    const saa = (form.get('saa') || '').toString().trim();
    const positiiviset = (form.get('positiiviset_tapahtumat') || '').toString().trim();
    const negatiiviset = (form.get('negatiiviset_tapahtumat') || '').toString().trim();
    const tulokset = (form.get('tulokset') || '').toString().trim();
    const muuta = (form.get('muuta') || '').toString().trim();

    if (!aihe) return fail('Aihe on pakollinen', 400);
    if (!ALLOWED_CATEGORIES.includes(category)) return fail('Valitse kelvollinen kategoria', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paivays)) return fail('Anna kelvollinen tapahtumapäivä', 400);
    if (!paikka) return fail('Paikka on pakollinen', 400);
    if (!positiiviset) return fail('Positiiviset tapahtumat on pakollinen', 400);
    if (!tulokset) return fail('Tulokset on pakollinen', 400);

    const prompt = buildPrompt({
      aihe, category: CATEGORY_LABELS[category] || category, paivays, paikka, saa,
      positiiviset, negatiiviset, tulokset, muuta,
    });
    let title, body;
    let geminiRaw = '';
    try {
      geminiRaw = await callGemini(env.GEMINI_API_KEY, prompt);
      const parsed = parseGeminiJson(geminiRaw);
      title = (parsed.title || '').toString().trim();
      body = (parsed.body || '').toString().trim();
    } catch (e) {
      console.error('Gemini generation/parse failed:', e, 'raw:', geminiRaw?.substring(0, 300));
      return fail(`Tekoälyn vastaus epäonnistui: ${e.message} | raw: ${geminiRaw?.substring(0, 200)}`, 502);
    }
    if (!title || !body) return fail(`Tekoäly ei tuottanut kelvollista uutista — title: "${title?.slice(0,20)}", body length: ${body?.length || 0}`, 422);
    title = clamp(title, TITLE_MAX);
    body = clamp(body, BODY_MAX);

    return ok({ title, body });
  } catch (e) {
    console.error('generate-article unexpected error:', e);
    return fail('Palvelinvirhe', 500);
  }
}
