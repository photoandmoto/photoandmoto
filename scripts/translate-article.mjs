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

// Split into two schemas so each Gemini call stays small. The article body
// is the only large field; bundling it with the metadata in one response was
// what blew the output-token budget (truncated JSON dropped the required
// `title`, producing a malformed EN file). Translating metadata and body in
// separate calls keeps each well under the cap.
//
// `tags` is deliberately NOT translated by the model. Per SYSTEM_PROMPT rule 8
// the site's tags are proper nouns / sport terms (MXGP, MX2, Motocross) that
// stay as-is anyway, and asking Gemini for them triggered a degenerate
// repetition loop that consumed the entire output budget (MAX_TOKENS, 90k+
// chars of repeated tags). We reuse the Finnish tags verbatim instead.
const META_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    seo_description: { type: 'string' },
    image_caption: { type: 'string' },
  },
  required: ['title'],
};

const BODY_SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string' },
  },
  required: ['body'],
};

function buildMetaPrompt(fm, glossary) {
  const fields = {
    title: fm.title || '',
    subtitle: fm.subtitle || null,
    seo_description: fm.seo_description || null,
    image_caption: fm.image_caption || null,
  };

  let glossarySection = '';
  if (glossary && glossary.trim()) {
    glossarySection = `\n\nSITE-SPECIFIC GLOSSARY (overrides — apply these exact substitutions):\n${glossary.trim()}\n`;
  }

  return `Translate ONLY these Finnish article metadata fields to English. Do NOT translate or output the article body. Do NOT output tags. Return JSON matching the response schema.${glossarySection}

SOURCE METADATA FIELDS (Finnish):
${JSON.stringify(fields, null, 2)}`;
}

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

  // Translate in two separate calls so the large body never shares an output
  // budget with the metadata. Both calls go through the retry wrapper to ride
  // out transient Gemini failures (503/429/MAX_TOKENS).
  // Call 1: metadata (title/subtitle/seo/caption) — tiny, capped at 1024 tokens
  //   so a runaway response dies in seconds instead of burning the full budget.
  // Call 2: body — the only large field, alone in its response, full budget.
  const metaPrompt = buildMetaPrompt(fiFrontmatter, glossary);
  console.log('Gemini call 1/2: metadata');
  const meta = await callGeminiWithRetry(SYSTEM_PROMPT, metaPrompt, apiKey, META_SCHEMA, 1024, 'metadata');

  const bodyPrompt = buildBodyPrompt(fiBody, glossary);
  console.log('Gemini call 2/2: body');
  const bodyResult = await callGeminiWithRetry(SYSTEM_PROMPT, bodyPrompt, apiKey, BODY_SCHEMA, 32768, 'body');

  // Merge into the shape the rest of main() expects. Tags are NOT model-
  // translated (see META_SCHEMA note) — reuse the Finnish tags verbatim.
  const translated = {
    title: meta.title,
    subtitle: meta.subtitle,
    seo_description: meta.seo_description,
    image_caption: meta.image_caption,
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
