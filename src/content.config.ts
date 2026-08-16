import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

const articlesCollection = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    // .nullish() = string | null | undefined. Decap writes `null` for empty
    // optional fields rather than omitting them; the schema must accept that.
    subtitle: z.string().nullish(),
    author: z.string().default('Photo & Moto'),
    date: z.date(),
    // Was z.enum(...). Now data-driven via the `categories` collection so editors
    // can add new categories from Decap without a code change. Validation is at
    // the Decap UI layer (relation widget restricts picks to existing entries).
    category: z.string(),
    tags: z.array(z.string()),
    featured_image: z.string().nullish(),
    featured_image_focus: z.enum(['top', 'center', 'bottom']).optional(),
    card_image: z.string().nullish(),
    card_image_focus: z.enum(['top', 'center', 'bottom']).optional(),
    // Booleans use preprocess to coerce null → default. Decap's i18n:duplicate
    // copies "default-but-unset" values as `null` to the non-default locale,
    // which would otherwise fail boolean validation.
    show_hero: z.preprocess((v) => v ?? true, z.boolean()),
    image_caption: z.string().nullish(),
    language: z.enum(['fi', 'en']).optional(),
    draft: z.preprocess((v) => v ?? false, z.boolean()),
    seo_description: z.string().max(160).nullish(),
    sources: z.string().nullish(),
  }),
});

// Pikauutiset — short AI-assisted news flashes (Yleinen Kynä Phase 2). Lean,
// FI-only, separate collection. The 2–3 sentence text lives in the markdown
// BODY (content area) — same as the articles collection, which is why `body`
// is not a frontmatter field here (Sveltia reserves the `body` name for the
// content area). generate-article.js validates title + body non-empty before
// committing. `source` is always 'ai_generated'; `author` always from the IAM
// session; `draft` always starts true.
const pikauutisetCollection = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pikauutiset' }),
  schema: z.object({
    title: z.string(),
    date: z.date(),
    // Safety net: a pikauutinen with no author (or an empty/null one, which is
    // what Decap/Sveltia writes for a cleared field) used to fail validation and
    // take down the whole production build — content collections are validated
    // for drafts too, so a submission could break the deploy before Toimitus
    // ever reviewed it. Both write paths now always set a real author; this
    // preprocess only exists so that a missing one can never block a deploy.
    author: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() !== '' ? v : 'Photo & Moto'),
      z.string()
    ),
    category: z.string(),
    photo: z.string().nullish(),
    draft: z.preprocess((v) => v ?? false, z.boolean()),
    source: z.string().default('ai_generated'),
  }),
});

const galleriesCollection = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/galleries' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    description: z.string(),
    // Galleries are shared between FI and EN (one file, not one per locale), so
    // the English pages need their own copy of the blurb. Optional: pages fall
    // back to `description` when it is absent.
    description_en: z.string().nullish(),
    // Optional SEO overrides for the <title> and meta description, per locale.
    // When absent, pages fall back to `title` / `description` (+ `_en`). Keep
    // seo_description under ~160 chars for clean SERP snippets.
    seo_title: z.string().nullish(),
    seo_title_en: z.string().nullish(),
    seo_description: z.string().max(200).nullish(),
    seo_description_en: z.string().max(200).nullish(),
    cover_image: z.string(),
    images: z.array(
      z.object({
        filename: z.string(),
        thumb: z.string().optional(),
        display: z.string().optional(),
        caption: z.string().optional(),
        photographer: z.string().default('Matti Tarkkonen'),
        date: z.string().optional(),
        width: z.number(),
        height: z.number(),
      })
    ),
    category: z.enum(['international', 'finland', 'enduro', 'scramble', 'black-white']),
  }),
});

const categoriesCollection = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/categories' }),
  schema: z.object({
    name: z.string(),
    label: z.string(),
  }),
});

export const collections = {
  articles: articlesCollection,
  pikauutiset: pikauutisetCollection,
  galleries: galleriesCollection,
  categories: categoriesCollection,
};

