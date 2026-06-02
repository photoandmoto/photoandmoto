#!/usr/bin/env node
// Translates a Finnish article to English using Gemini 2.5 Pro.
//
// Usage:  node scripts/translate-article.mjs <fi-markdown-path>
//
// Reads src/content/articles/fi/<slug>.md, calls Gemini, writes
// src/content/articles/en/<slug>.md with translated content.
//
// Preserved from FI:    date, category, featured_image, card_image,
//                       show_hero, draft, slug (filename)
// Translated:           title, subtitle, image_caption, seo_description,
//                       tags, body (markdown)
// Set on output:        language: en, auto_translated: true,
//                       translated_from: <slug>, translated_at: <ISO>
//
// Requires GEMINI_API_KEY env var.
//
// Exits non-zero on failure so the GitHub Action fails the build.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

// Flash, not Pro — translation is mechanical and Flash is fast + cheap.
// Pro requires thinking mode (can't be disabled), which ate the output
// budget on long articles in earlier runs.
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// ---------------------------------------------------------------------------
// Frontmatter helpers (input + output use js-yaml for robustness)
// ---------------------------------------------------------------------------

function splitFrontmatter(markdown) {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('No frontmatter found');
  return { yamlText: m[1], body: m[2].trimEnd() };
}

function buildOutputMarkdown(frontmatter, body) {
  const yamlText = yaml.dump(frontmatter, {
    lineWidth: -1,    // never wrap, keeps long strings on one line
    noRefs: true,
    quotingType: '"',
  });
  return `---\n${yamlText}---\n\n${body}\n`;
}

// ---------------------------------------------------------------------------
// Gemini API call
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a professional translator specializing in motorcycle history and motocross/speedway journalism. Translate Finnish content to high-quality natural English.

RULES:
1. Preserve all proper nouns exactly: rider names (e.g. Heikki Mikkola), place names (e.g. Hyvinkää), team names (e.g. Sandblowers), motorcycle brands and models (e.g. Honda CR250, Husqvarna).
2. Preserve sport-specific terms unchanged: MXGP, MX1, MX2, FIM, AMA, motocross, speedway, enduro, trial, scramble, MotoGP.
3. Preserve class designations exactly: 50cc, 125cc, 250cc, 500cc, 750cc, etc.
4. Preserve all markdown structure: headings (#, ##, ###), bold/italic, links [text](url), images ![alt](path), code blocks (\`\`\`), blockquotes (>), lists (- / *), tables.
5. Preserve all image paths and URLs exactly (e.g. /images/sandblowers-ryhma.jpg, https://example.com).
6. Translate "Suomi" → "Finland" but keep specific Finnish town names (Hyvinkää, Varkaus, Lahti, etc.) as-is.
7. Use British English conventions (colour, centre, organised) for consistency with existing site translations.
8. For tags: translate generic descriptive terms (e.g. "historia" → "history") but keep proper nouns and sport terms as-is.
9. Match the source tone — informal, anecdotal, knowledgeable about motorsport history.
10. Translate ONLY the content. Do NOT add disclaimers, notes, or commentary about the translation process.`;

// The article body is the only large field; it gets its own schema'd call.
// Metadata fields (title/subtitle/seo/caption) are each a single short line
// and are translated INDIVIDUALLY as plain text (see translateField), NOT via
// a JSON metadata schema. Reason: asking the model for a JSON object of
// metadata fields repeatedly triggered a degenerate repetition loop — first on
// `tags`, then on `subtitle` — where the model concatenated the body and the
// Finnish source over and over until it hit the token cap and produced
// unparseable JSON. A one-field-at-a-time plain-string translation cannot loop
// across fields, cannot drop a required key, and cannot emit invalid JSON.
const BODY_SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string' },
  },
  required: ['body'],
};

function buildBodyPrompt(body, glossary) {
  let glossarySection = '';
  if (glossary && glossary.trim()) {
    glossarySection = `\n\nSITE-SPECIFIC GLOSSARY (overrides — apply these exact substitutions):\n${glossary.trim()}\n`;
  }

  return `Translate this Finnish article body to English. Preserve all markdown structure exactly. Return JSON matching the response schema (a single "body" field containing the full translated markdown).${glossarySection}

SOURCE BODY (Finnish markdown):
${JSON.stringify({ body }, null, 2)}`;
}

async function callGemini(systemPrompt, userPrompt, apiKey, responseSchema, maxTokens) {
  const url = `${ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.3,
      // Gemini 2.5 Pro reasons internally with "thinking" tokens that count
      // against the output budget. Translation is mechanical — no thinking
      // needed. Disabling it gives the full budget to actual output.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: maxTokens,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Gemini API ${res.status}: ${text}`);
    // 429 (rate limit), 500/503 (overloaded/unavailable) are transient.
    if (res.status === 429 || res.status >= 500) err.retryable = true;
    throw err;
  }

  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw new Error(`Gemini returned no candidates: ${JSON.stringify(data)}`);

  // Diagnostic: log finish reason and usage so truncation is obvious next time.
  const finishReason = candidate.finishReason || 'unknown';
  const usage = data.usageMetadata || {};
  console.log(`Gemini finished (reason=${finishReason}, prompt=${usage.promptTokenCount}, output=${usage.candidatesTokenCount}, total=${usage.totalTokenCount})`);

  const text = candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!text) throw new Error(`Gemini returned no text. finishReason=${finishReason}, candidate=${JSON.stringify(candidate).slice(0, 500)}`);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const err = new Error(`Gemini returned non-JSON (length=${text.length}, finishReason=${finishReason}). First 500 chars: ${text.slice(0, 500)}\n\nLast 500 chars: ${text.slice(-500)}`);
    // MAX_TOKENS truncation yields unparseable JSON; a retry may complete.
    if (finishReason === 'MAX_TOKENS') err.retryable = true;
    throw err;
  }
  return parsed;
}

// Retry wrapper: transient Gemini failures (503 overloaded, 429 rate-limit,
// MAX_TOKENS truncation) are common and self-clearing. Retry a few times with
// exponential backoff before giving up, so a momentary spike doesn't fail the
// whole Action and leave the article untranslated.
async function callGeminiWithRetry(systemPrompt, userPrompt, apiKey, responseSchema, maxTokens, label) {
  const MAX_ATTEMPTS = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callGemini(systemPrompt, userPrompt, apiKey, responseSchema, maxTokens);
    } catch (e) {
      lastErr = e;
      if (!e.retryable || attempt === MAX_ATTEMPTS) throw e;
      const delayMs = 2000 * attempt; // 2s, 4s
      console.log(`${label}: transient failure (${e.message.slice(0, 80)}...). Retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delayMs}ms.`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// Plain-text Gemini call (no JSON schema). Used for translating single short
// metadata fields. Returns the model's text output, trimmed. Marks transient
// failures retryable just like callGemini so the retry wrapper can ride them.
async function callGeminiText(systemPrompt, userPrompt, apiKey, maxTokens) {
  const url = `${ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.3,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: maxTokens,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Gemini API ${res.status}: ${text}`);
    if (res.status === 429 || res.status >= 500) err.retryable = true;
    throw err;
  }

  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw new Error(`Gemini returned no candidates: ${JSON.stringify(data)}`);
  const finishReason = candidate.finishReason || 'unknown';
  const text = candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!text) throw new Error(`Gemini returned no text. finishReason=${finishReason}`);
  return text.trim();
}

// Translate one short metadata field as plain text, with retry. Empty/whitespace
// input short-circuits to null (no API call). The model is told to return ONLY
// the translated line, nothing else — and because there's a single short field
// and no JSON structure, the cross-field repetition loop cannot occur. Capped
// tight (256 tokens) so any anomaly fails in milliseconds.
async function translateField(value, fieldName, apiKey, glossary) {
  const src = (value == null ? '' : String(value)).trim();
  if (!src) return null;

  let glossarySection = '';
  if (glossary && glossary.trim()) {
    glossarySection = `\n\nSITE-SPECIFIC GLOSSARY (overrides — apply these exact substitutions):\n${glossary.trim()}\n`;
  }

  const prompt = `Translate this single Finnish article ${fieldName} to English. Return ONLY the translated text on one line, with no quotes, no labels, no JSON, no commentary, and do not repeat or append anything else.${glossarySection}

FINNISH ${fieldName.toUpperCase()}:
${src}`;

  const MAX_ATTEMPTS = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const out = await callGeminiText(SYSTEM_PROMPT, prompt, apiKey, 256);
      // Collapse any stray newlines a model might emit into a single line.
      const oneLine = out.replace(/\s*\n+\s*/g, ' ').trim();
      if (!oneLine) throw new Error(`empty translation for ${fieldName}`);
      return oneLine;
    } catch (e) {
      lastErr = e;
      if (!e.retryable || attempt === MAX_ATTEMPTS) throw e;
      const delayMs = 2000 * attempt;
      console.log(`${fieldName}: transient failure (${e.message.slice(0, 80)}...). Retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delayMs}ms.`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// Decision: translate if EN file is missing OR has auto_translated === true.
// Otherwise the EN file is a human-reviewed translation (or pre-existing
// content) and we leave it alone. Pass --force to override.
async function shouldTranslate(enPath, force) {
  if (force) return true;
  try {
    const text = await readFile(enPath, 'utf8');
    const { yamlText } = splitFrontmatter(text);
    const fm = yaml.load(yamlText) || {};
    return fm.auto_translated === true;
  } catch (e) {
    if (e.code === 'ENOENT') return true;
    throw e;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const inputPath = args.find((a) => !a.startsWith('--'));
  if (!inputPath) {
    console.error('Usage: node scripts/translate-article.mjs <fi-markdown-path> [--force]');
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY env var not set');
    process.exit(1);
  }

  const slug = path.basename(inputPath, '.md');
  const outputPath = path.join('src/content/articles/en', `${slug}.md`);

  // Skip if EN file exists and is not flagged for re-translation.
  const should = await shouldTranslate(outputPath, force);
  if (!should) {
    console.log(`SKIP: ${outputPath} exists and auto_translated is not true (use --force to override)`);
    return;
  }

  console.log(`Translating: ${inputPath} -> ${outputPath}`);

  // Read FI source
  const sourceText = await readFile(inputPath, 'utf8');
  const { yamlText, body: fiBody } = splitFrontmatter(sourceText);
  const fiFrontmatter = yaml.load(yamlText) || {};

  // Load glossary (best effort — file may not exist)
  let glossary = '';
  try {
    glossary = await readFile('scripts/translation-glossary.md', 'utf8');
  } catch {
    console.log('No glossary file found, proceeding without overrides.');
  }

  // Translate metadata fields INDIVIDUALLY as plain text (title/subtitle/seo/
  // caption). Each is one short line; doing them one at a time eliminates the
  // cross-field repetition loop that previously corrupted the metadata JSON.
  console.log('Translating metadata fields');
  const metaTitle = await translateField(fiFrontmatter.title, 'title', apiKey, glossary);
  const metaSubtitle = await translateField(fiFrontmatter.subtitle, 'subtitle', apiKey, glossary);
  const metaSeo = await translateField(fiFrontmatter.seo_description, 'SEO description', apiKey, glossary);
  const metaCaption = await translateField(fiFrontmatter.image_caption, 'image caption', apiKey, glossary);

  // Body is large — schema'd call with full budget, through the retry wrapper.
  const bodyPrompt = buildBodyPrompt(fiBody, glossary);
  console.log('Translating body');
  const bodyResult = await callGeminiWithRetry(SYSTEM_PROMPT, bodyPrompt, apiKey, BODY_SCHEMA, 32768, 'body');

  // Merge into the shape the rest of main() expects. Tags are NOT model-
  // translated (proper nouns / sport terms) — reuse the Finnish tags verbatim.
  const translated = {
    title: metaTitle,
    subtitle: metaSubtitle,
    seo_description: metaSeo,
    image_caption: metaCaption,
    tags: Array.isArray(fiFrontmatter.tags) ? fiFrontmatter.tags : [],
    body: bodyResult.body,
  };

  // Guard: a truncated Gemini response (finishReason=MAX_TOKENS) can drop
  // schema-required fields. js-yaml then silently omits the missing key,
  // producing an EN file with no `title:` that fails Astro's content schema
  // and breaks the Cloudflare build one stage later. Fail HERE instead so
  // the Action surfaces the problem and no malformed EN file is committed.
  if (!translated.title || !String(translated.title).trim()) {
    throw new Error(
      `Translation returned an empty title for ${slug} — likely a truncated ` +
      `Gemini response (check finishReason above; MAX_TOKENS means the output ` +
      `budget was exceeded). Aborting so no malformed EN file is committed.`
    );
  }
  if (!translated.body || !String(translated.body).trim()) {
    throw new Error(
      `Translation returned an empty body for ${slug} — likely a truncated ` +
      `Gemini response. Aborting so no malformed EN file is committed.`
    );
  }

  // Build EN frontmatter — preserve immutable fields, replace translated ones,
  // set machine-translation metadata.
  const enFrontmatter = {
    title: translated.title,
    ...(translated.subtitle ? { subtitle: translated.subtitle } : {}),
    author: fiFrontmatter.author || 'Photo & Moto',
    date: fiFrontmatter.date,
    category: fiFrontmatter.category,
    tags: Array.isArray(translated.tags) ? translated.tags : (fiFrontmatter.tags || []),
    ...(fiFrontmatter.featured_image ? { featured_image: fiFrontmatter.featured_image } : {}),
    ...(fiFrontmatter.card_image ? { card_image: fiFrontmatter.card_image } : {}),
    show_hero: fiFrontmatter.show_hero !== undefined ? fiFrontmatter.show_hero : false,
    ...(translated.image_caption ? { image_caption: translated.image_caption } : {}),
    language: 'en',
    draft: fiFrontmatter.draft === true,
    ...(translated.seo_description ? { seo_description: translated.seo_description } : {}),
    auto_translated: true,
    translated_from: slug,
    translated_at: new Date().toISOString(),
  };

  const outputMarkdown = buildOutputMarkdown(enFrontmatter, translated.body || '');
  await writeFile(outputPath, outputMarkdown, 'utf8');

  console.log(`Wrote ${outputPath} (${outputMarkdown.length} bytes)`);
}

main().catch((e) => {
  console.error('translate-article failed:', e.message);
  process.exit(1);
});
