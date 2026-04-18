import { defineCollection, z } from 'astro:content';

const articlesCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    author: z.string().default('Matti Tarkkonen'),
    date: z.date(),
    category: z.enum(['MXGP', 'Enduro', 'Speedway', 'Historical', 'Technical', 'Interview']),
    tags: z.array(z.string()),
    featured_image: z.string(),
    image_caption: z.string().optional(),
    language: z.enum(['fi', 'en']),
    draft: z.boolean().default(false),
    seo_description: z.string().max(160).optional(),
  }),
});

const galleriesCollection = defineCollection({
  type: 'data',
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
