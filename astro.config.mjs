import { defineConfig } from 'astro/config';

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
  integrations: [],
});