import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import pagefind from 'astro-pagefind';

export default defineConfig({
  site: 'https://www.photoandmoto.fi',
  i18n: {
    defaultLocale: 'fi',
    locales: ['fi', 'en'],
    routing: {
      prefixDefaultLocale: true,
    },
  },
  image: {
    domains: ['photoandmoto.fi'],
    formats: ['webp', 'avif'],
    quality: 80,
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'fi',
        locales: {
          fi: 'fi-FI',
          en: 'en-US',
        },
      },
      filter: (page) => !page.includes('/haku') && !page.includes('/tilastot'),
    }),
    pagefind(),
  ],
});
