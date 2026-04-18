# Photo & Moto Website

Modern static website for motorsport history photos and stories. Built with Astro, deployed on Cloudflare Pages.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev
# → http://localhost:4321

# Build for production
npm run build

# Preview production build
npm run preview
```

## Adding Content

### Add a New Gallery

```bash
# 1. Copy photos to gallery folder
mkdir -p src/assets/galleries/my-gallery
cp ~/photos/*.jpg src/assets/galleries/my-gallery/

# 2. Generate gallery manifest
npm run generate-gallery my-gallery

# 3. Preview
npm run dev
# → Visit http://localhost:4321/fi/galleria/my-gallery

# 4. Deploy
git add .
git commit -m "Add my-gallery"
git push
```

### Add a New Article

```bash
# 1. Create markdown file
touch src/content/articles/fi/my-article.md

# 2. Add frontmatter and content
---
title: "Article Title"
subtitle: "Subtitle here"
date: 2026-04-18
category: "MXGP"
tags: ["motocross", "racing"]
featured_image: "/src/assets/articles/my-article/hero.jpg"
language: "fi"
---

Your article content here...

# 3. Add images
mkdir -p src/assets/articles/my-article
cp ~/hero.jpg src/assets/articles/my-article/

# 4. Preview and deploy
npm run dev
git add . && git commit -m "Add article" && git push
```

## Project Structure

```
photoandmoto/
├── src/
│   ├── assets/           # Images (processed by Astro)
│   │   ├── galleries/    # Gallery photos
│   │   ├── articles/     # Article images
│   │   └── site/         # Site assets (logo, etc)
│   ├── components/       # Reusable components
│   ├── content/          # Content collections
│   │   ├── articles/     # Markdown articles
│   │   └── galleries/    # Gallery manifests (JSON)
│   ├── i18n/             # Translations
│   ├── layouts/          # Page layouts
│   ├── pages/            # Routes (fi/ and en/)
│   ├── styles/           # CSS
│   └── utils/            # Helper functions
├── scripts/              # Build scripts
└── public/               # Static files
```

## Deployment

Automatic deployment via Cloudflare Pages:
- Push to `main` branch → Production deploy
- Push to other branches → Preview deploy

## Tech Stack

- **Framework**: Astro 4.5
- **Gallery**: PhotoSwipe 5.4
- **Image Processing**: Sharp
- **Hosting**: Cloudflare Pages
- **Languages**: Finnish (fi), English (en)

## Development

- Node.js 20+ required
- Runs on localhost:4321
- Hot reload enabled
- TypeScript strict mode

## License

© 2026 Photo & Moto - All Rights Reserved
