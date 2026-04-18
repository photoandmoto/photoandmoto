import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://photoandmoto.fi',
  
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
  
  build: {
    inlineStylesheets: 'auto',
    assets: '_astro',
  },
  
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'fi',
        locales: {
          fi: 'fi',
          en: 'en',
        },
      },
    }),
  ],
  
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
    smartypants: true,
  },
  
  vite: {
    build: {
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
    },
  },
});
