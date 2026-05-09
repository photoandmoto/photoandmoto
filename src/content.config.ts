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
    category: z.enum(['MXGP', 'Enduro', 'Speedway', 'Historical', 'Technical', 'Interview']),
    tags: z.array(z.string()),
    featured_image: z.string().nullish(),
    card_image: z.string().nullish(),
    // Booleans use preprocess to coerce null → default. Decap's i18n:duplicate
    // copies "default-but-unset" values as `null` to the non-default locale,
    // which would otherwise fail boolean validation.
    show_hero: z.preprocess((v) => v ?? true, z.boolean()),
    image_caption: z.string().nullish(),
    language: z.enum(['fi', 'en']).optional(),
    draft: z.preprocess((v) => v ?? false, z.boolean()),
    seo_description: z.string().max(160).nullish(),
    auto_translated: z.boolean().nullish(),
    translated_from: z.string().nullish(),
    translated_at: z.string().nullish(),
  }),
});

const galleriesCollection = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/galleries' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    description: z.string(),
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

export const collections = {
  articles: articlesCollection,
  galleries: galleriesCollection,
};
