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

const MODEL = 'gemini-2.5-pro';
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

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    seo_description: { type: 'string' },
    image_caption: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    body: { type: 'string' },
  },
  required: ['title', 'body'],
};

function buildUserPrompt(fm, body, glossary) {
  const fields = {
    title: fm.title || '',
    subtitle: fm.subtitle || null,
    seo_description: fm.seo_description || null,
    image_caption: fm.image_caption || null,
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    body,
  };

  let glossarySection = '';
  if (glossary && glossary.trim()) {
    glossarySection = `\n\nSITE-SPECIFIC GLOSSARY (overrides — apply these exact substitutions):\n${glossary.trim()}\n`;
  }

  return `Translate this Finnish article to English. Return JSON matching the response schema.${glossarySection}

SOURCE FIELDS (Finnish):
${JSON.stringify(fields, null, 2)}`;
}

async function callGemini(systemPrompt, userPrompt, apiKey) {
  const url = `${ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.3,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API ${res.status}: ${text}`);
  }

  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw new Error(`Gemini returned no candidates: ${JSON.stringify(data)}`);
  const text = candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!text) throw new Error(`Gemini returned no text: ${JSON.stringify(candidate)}`);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  }
  return parsed;
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

  // Translate
  const userPrompt = buildUserPrompt(fiFrontmatter, fiBody, glossary);
  const translated = await callGemini(SYSTEM_PROMPT, userPrompt, apiKey);

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
