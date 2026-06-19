// POST /api/generate-article
//
// Yleinen Kynä Phase 2 — a logged-in contributor (perm_laheta_artikkeli) fills a
// structured keyword form; Gemini turns it into a short Finnish "pikauutinen"
// (news flash). Flow:
//   1. requireAuth(..., 'laheta_artikkeli')
//   2. Rate-limit: max 3 generations per IP per hour (in-memory)
//   3. Parse multipart form, validate mandatory fields
//   4. Call Gemini with the hardcoded prompt template → strict JSON {title, body}
//   5. Validate non-empty; clamp title ≤80, body ≤500 chars
//   6. Optional photo → committed into the repo at public/images/<file>
//   7. Commit draft .md (+ photo) to src/content/pikauutiset/<date>-<slug>.md on
//      the target branch (dev on staging) via the Photoandmoto Publisher App
//   8. Email the editor via Resend
//
// Hard rules (YLEINEN_KYNA.md Phase 2): author ALWAYS from the IAM session (never
// form/Gemini); draft ALWAYS true; source ALWAYS "ai_generated". The 2–3 sentence
// text is the markdown BODY (content area), same as the articles collection.

import { requireAuth, getClientIp } from '../_lib/auth.js';

const REPO_OWNER = 'photoandmoto';
const REPO_NAME = 'photoandmoto';
const EDITOR_INBOX = 'photoandmoto@gmail.com';
const FROM = 'Photo & Moto <noreply@photoandmoto.fi>';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const TITLE_MAX = 80;
const BODY_MAX = 500;

// Category → Finnish label. The label drives Gemini's tone (no separate Sävy
// field); the English `name` is what gets stored in frontmatter (matches the
// categories collection + relation widget).
// Category `name` (stored in frontmatter) → Finnish label (drives Gemini tone).
// Must match the categories collection in src/content/categories/.
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

// ---------------------------------------------------------------------------
// JSON responses
// ---------------------------------------------------------------------------
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const ok = (d) => json({ ok: true, ...d });
const fail = (msg, status = 400) => json({ ok: false, error: msg }, status);

// ---------------------------------------------------------------------------
// Rate limit — max 3 per IP per hour (in-memory, Worker-level). Best-effort:
// resets when the isolate recycles, which is acceptable for abuse-throttling.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map(); // ip -> number[] (timestamps)
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
// base64 / JWT helpers (copied from functions/api/submit-article.js)
// ---------------------------------------------------------------------------
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}
function utf8ToBase64(str) { return bytesToBase64(new TextEncoder().encode(str)); }
function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function utf8ToBase64Url(str) { return bytesToBase64Url(new TextEncoder().encode(str)); }

async function importPrivateKey(pemString) {
  const pem = pemString
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const der = base64ToBytes(pem);
  try {
    return await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    const pkcs8Header = new Uint8Array([
      0x30, 0x82, 0x00, 0x00, 0x02, 0x01, 0x00, 0x30, 0x0d,
      0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
      0x05, 0x00, 0x04, 0x82, 0x00, 0x00,
    ]);
    const totalLen = pkcs8Header.length + der.length;
    pkcs8Header[2] = ((totalLen - 4) >> 8) & 0xff;
    pkcs8Header[3] = (totalLen - 4) & 0xff;
    pkcs8Header[pkcs8Header.length - 2] = (der.length >> 8) & 0xff;
    pkcs8Header[pkcs8Header.length - 1] = der.length & 0xff;
    const wrapped = new Uint8Array(totalLen);
    wrapped.set(pkcs8Header, 0);
    wrapped.set(der, pkcs8Header.length);
    return await crypto.subtle.importKey('pkcs8', wrapped, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
}
async function signAppJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 8 * 60, iss: String(appId) };
  const signingInput = `${utf8ToBase64Url(JSON.stringify(header))}.${utf8ToBase64Url(JSON.stringify(payload))}`;
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`;
}
async function getInstallationToken(appJwt, installationId) {
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${appJwt}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'photoandmoto-publisher' },
  });
  if (!res.ok) throw new Error(`Installation token request failed (${res.status}): ${await res.text()}`);
  return (await res.json()).token;
}
async function gh(token, path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'photoandmoto-publisher',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}
const getBranchHead = async (t, b) => (await gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${encodeURIComponent(b)}`)).object.sha;
const getCommit = (t, sha) => gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${sha}`);
const createBlob = (t, contentBase64) => gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: contentBase64, encoding: 'base64' }) });
const createTree = (t, baseTreeSha, tree) => gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseTreeSha, tree }) });
const createCommit = (t, message, treeSha, parentSha) => gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }) });
const updateBranch = (t, b, sha) => gh(t, `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${encodeURIComponent(b)}`, { method: 'PATCH', body: JSON.stringify({ sha, force: false }) });

async function fileExists(token, branch, path) {
  const url = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(`https://api.github.com${url}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'photoandmoto-publisher' },
  });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`GitHub contents check failed (${res.status}): ${await res.text()}`);
}

function targetBranch(env) {
  return (env.CF_PAGES_BRANCH || env.CF_PAGES_TARGET_BRANCH || '') === 'main' ? 'main' : 'dev';
}

// ---------------------------------------------------------------------------
// Slug + filename sanitization (ASCII, git-safe — copied from submit-article.js)
// ---------------------------------------------------------------------------
function foldNordic(s) {
  return s.replace(/[äà]/g, 'a').replace(/[öø]/g, 'o').replace(/å/g, 'a').replace(/[éè]/g, 'e').replace(/ü/g, 'u');
}
function slugify(title) {
  const s = foldNordic(String(title || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'pikauutinen';
}
function sanitizeImageName(name) {
  const dot = String(name || '').lastIndexOf('.');
  let base = dot > 0 ? name.slice(0, dot) : (name || 'kuva');
  let ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  base = foldNordic(base.toLowerCase())
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!base) base = 'kuva';
  if (!/^\.(jpe?g|png|webp)$/.test(ext)) ext = '.jpg';
  return base + ext;
}
// Prepare one File for committing to public/images/<prefix>-<name>.
function prepareImage(prefix, file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`Kuva on liian suuri (max 10 MB): ${file.name}`);
  const safe = `${prefix}-${sanitizeImageName(file.name)}`;
  return { repoPath: `public/images/${safe}`, publicPath: `/images/${safe}`, file };
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

async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 800, temperature: 0.6, responseMimeType: 'application/json' },
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) throw new Error('Gemini palautti tyhjän vastauksen');
  return out;
}

// Parse Gemini output as strict JSON {title, body}. Tolerates code fences and
// surrounding prose by extracting the first {...} block.
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

// Pikauutinen markdown: lean frontmatter + the 2–3 sentence text as the BODY.
function buildMarkdown(fm, body) {
  const L = [
    '---',
    `title: ${JSON.stringify(fm.title)}`,
    `date: ${fm.date}`,
    `author: ${JSON.stringify(fm.author)}`,
    `category: ${JSON.stringify(fm.category)}`,
    `photo: ${fm.photo ? JSON.stringify(fm.photo) : 'null'}`,
    'draft: true',
    'source: "ai_generated"',
    '---',
    '',
    body,
    '',
  ];
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function onRequestPost({ request, env }) {
  try {
    // 1. Auth — contributor must have perm_laheta_artikkeli.
    const auth = await requireAuth(request, env, 'laheta_artikkeli');
    if (auth.error) return fail(auth.error, auth.status);

    if (!env.GEMINI_API_KEY) return fail('Tekoälypalvelua ei ole määritetty (GEMINI_API_KEY)', 500);
    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
      return fail('GitHub App -asetukset puuttuvat', 500);
    }

    // 2. Rate limit — 3 per IP per hour.
    const ip = getClientIp(request) || 'unknown';
    if (!checkRateLimit(ip, Date.now())) {
      return fail('Liian monta pikauutista tunnissa (enintään 3). Yritä myöhemmin uudelleen.', 429);
    }

    // 3. Parse + validate the multipart form.
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

    const photo = form.get('photo');
    const hasPhoto = photo && typeof photo !== 'string' && photo.size > 0;

    // Author ALWAYS from the IAM session — never from the form or Gemini.
    const author = `${auth.user.first_name || ''} ${auth.user.last_name || ''}`.trim() || 'Photo & Moto';

    // 4. Generate via Gemini → strict JSON {title, body}.
    const prompt = buildPrompt({
      aihe, category: CATEGORY_LABELS[category] || category, paivays, paikka, saa,
      positiiviset, negatiiviset, tulokset, muuta,
    });
    let title, body;
    try {
      const parsed = parseGeminiJson(await callGemini(env.GEMINI_API_KEY, prompt));
      title = (parsed.title || '').toString().trim();
      body = (parsed.body || '').toString().trim();
    } catch (e) {
      console.error('Gemini generation/parse failed:', e);
      return fail('Tekoälyn vastaus epäonnistui — yritä uudelleen', 502);
    }
    // 5. Validate non-empty; clamp lengths.
    if (!title || !body) return fail('Tekoäly ei tuottanut kelvollista uutista — tarkista syötteet ja yritä uudelleen', 422);
    title = clamp(title, TITLE_MAX);
    body = clamp(body, BODY_MAX);

    // 6. GitHub App auth + unique slug (<date>-<slug>).
    const branch = targetBranch(env);
    let token;
    try {
      const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
      token = await getInstallationToken(jwt, env.GITHUB_APP_INSTALLATION_ID);
    } catch (e) {
      console.error('GitHub auth failed:', e);
      return fail('GitHub-todennus epäonnistui', 502);
    }

    let base = `${paivays}-${slugify(title)}`;
    let path = `src/content/pikauutiset/${base}.md`;
    try {
      if (await fileExists(token, branch, path)) {
        base = `${base}-${Date.now().toString(36).slice(-4)}`;
        path = `src/content/pikauutiset/${base}.md`;
      }
    } catch (e) {
      console.error('slug pre-flight failed:', e);
      return fail('GitHubin tarkistus epäonnistui', 502);
    }

    // 7. Optional photo → repo (public/images/).
    let photoPath = null, imageItem = null;
    if (hasPhoto) {
      try {
        imageItem = prepareImage(base, photo);
        photoPath = imageItem.publicPath;
      } catch (e) {
        console.error('photo prepare failed:', e);
        return fail(e.message || 'Kuvan käsittely epäonnistui', 400);
      }
    }

    const md = buildMarkdown({ title, date: paivays, author, category, photo: photoPath }, body);

    // 8. Commit the draft (+ photo) to the target branch.
    let commitSha = null;
    try {
      const headSha = await getBranchHead(token, branch);
      const baseTree = (await getCommit(token, headSha)).tree.sha;
      const treeItems = [];
      if (imageItem) {
        const bytes = new Uint8Array(await imageItem.file.arrayBuffer());
        const imgBlob = await createBlob(token, bytesToBase64(bytes));
        treeItems.push({ path: imageItem.repoPath, mode: '100644', type: 'blob', sha: imgBlob.sha });
      }
      const blob = await createBlob(token, utf8ToBase64(md));
      treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      const tree = await createTree(token, baseTree, treeItems);
      const commit = await createCommit(token, `Yleinen Kynä: new pikauutinen "${title}" (${author})`, tree.sha, headSha);
      const upd = await updateBranch(token, branch, commit.sha);
      commitSha = upd.object?.sha || commit.sha;
    } catch (e) {
      console.error('GitHub commit failed:', e);
      return fail('Pikauutisen tallennus epäonnistui', 502);
    }

    // 8b. Track the submission for the Hyväksynnät editorial board (non-fatal).
    try {
      await env.DB.prepare(
        `INSERT INTO submissions
           (type, status, title, author_id, author_name, author_email, category, github_slug, submitted_at)
         VALUES ('pikauutinen', 'odottaa', ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(title, auth.user.id, author, auth.user.email || null, category, base).run();
    } catch (e) {
      console.error('submissions insert failed (non-fatal):', e?.name, e?.message, e?.cause, String(e));
    }

    // 9. Notify the editor via Resend (non-fatal — the draft is already committed).
    let emailWarning = null;
    if (env.RESEND_API_KEY) {
      try {
        const sveltiaCmsUrl = (env.CF_PAGES_BRANCH === 'main' || !env.CF_PAGES_BRANCH)
          ? 'https://www.photoandmoto.fi/admin/#/collections/pikauutiset'
          : 'https://photoandmoto-staging.pages.dev/admin/#/collections/pikauutiset';
        const text =
`Otsikko: ${title}
Lähettäjä: ${author}
Kategoria: ${category}
Lähetetty: ${new Date().toISOString()}

Avaa Sveltia: ${sveltiaCmsUrl}`;
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM,
            to: [EDITOR_INBOX],
            reply_to: auth.user.email || undefined,
            subject: `Uusi pikauutinen odottaa tarkistusta — ${title}`,
            text,
          }),
        });
        if (!res.ok) { emailWarning = 'Ilmoitussähköpostin lähetys epäonnistui'; console.error('Resend error (pikauutinen):', res.status, await res.text().catch(() => '')); }
      } catch (e) {
        emailWarning = 'Ilmoitussähköpostin lähetys epäonnistui';
        console.error('Resend threw (pikauutinen):', e);
      }
    } else {
      emailWarning = 'RESEND_API_KEY puuttuu — ilmoitusta ei lähetetty';
    }

    return ok({ slug: base, title, body, branch, commit_sha: commitSha, email_warning: emailWarning });
  } catch (e) {
    console.error('generate-article unexpected error:', e);
    return fail('Palvelinvirhe', 500);
  }
}
