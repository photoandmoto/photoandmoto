import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import pagefind from 'astro-pagefind';

// Rehype plugin: turn a markdown image WITH a title — ![alt](src "Caption") —
// into <figure class="article-figure"><img><figcaption>Caption</figcaption></figure>,
// moving the title text into the figcaption. Images without a title are left
// as a plain <img>. Self-contained (no extra dependency).
function rehypeFigureFromTitle() {
  const isBlankText = (n) => n.type === 'text' && /^\s*$/.test(n.value);
  const makeFigure = (img) => {
    const title = img.properties.title;
    delete img.properties.title;
    return {
      type: 'element',
      tagName: 'figure',
      properties: { className: ['article-figure'] },
      children: [
        img,
        {
          type: 'element',
          tagName: 'figcaption',
          properties: {},
          children: [{ type: 'text', value: String(title) }],
        },
      ],
    };
  };
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      // A standalone image is rendered as <p><img></p>; replace the whole <p>
      // so we never nest <figure> inside <p> (invalid HTML).
      if (child.type === 'element' && child.tagName === 'p') {
        const meaningful = child.children.filter((c) => !isBlankText(c));
        if (
          meaningful.length === 1 &&
          meaningful[0].tagName === 'img' &&
          meaningful[0].properties?.title
        ) {
          node.children[i] = makeFigure(meaningful[0]);
          continue;
        }
      }
      if (child.type === 'element' && child.tagName === 'img' && child.properties?.title) {
        node.children[i] = makeFigure(child);
        continue;
      }
      walk(child);
    }
  };
  return (tree) => walk(tree);
}

export default defineConfig({
  site: 'https://www.photoandmoto.fi',
  markdown: {
    rehypePlugins: [rehypeFigureFromTitle],
  },
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
