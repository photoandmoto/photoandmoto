# Photo & Moto - Deployment Guide

## What You Have Now

✅ Complete Astro project structure  
✅ All pages (Finnish + English)  
✅ Gallery system ready  
✅ Article system ready  
✅ Design system complete  
✅ One example article  

## Step 1: Push to GitHub (Do This First!)

Open Terminal/Command Prompt on your computer and run:

```bash
# Clone or download the project folder to your computer first
# Then navigate to it:
cd photoandmoto

# Push to GitHub
git push -u origin main
```

**If asked for authentication:**
- Username: `photoandmoto`
- Password: Use your GitHub Personal Access Token (not your regular password)
  - Create token at: https://github.com/settings/tokens
  - Select: "repo" permissions
  - Copy the token and use it as password

---

## Step 2: Add Example Photos (15 minutes)

To see the gallery working immediately:

```bash
# 1. Download 10-15 photos from your current site
# Save them to: src/assets/galleries/international-i/

# 2. Generate gallery manifest
npm install
npm run generate-gallery international-i

# 3. Preview locally
npm run dev
# Visit: http://localhost:4321/fi/galleria/international-i

# 4. If it looks good, push to GitHub
git add .
git commit -m "Add International I gallery"
git push
```

---

## Step 3: Deploy to Cloudflare Pages (10 minutes)

### 3.1 Connect Repository

1. Log in to Cloudflare: https://dash.cloudflare.com
2. Go to **Pages** → **Create a project**
3. Click **Connect to Git**
4. Select your GitHub account
5. Choose repository: **photoandmoto/photoandmoto**

### 3.2 Configure Build

**Framework preset:** Astro  
**Build command:** `npm run build`  
**Build output directory:** `dist`  
**Root directory:** `/` (leave blank)  

**Environment variables:** (none needed)

Click **Save and Deploy**

### 3.3 Wait for Build

- First build takes ~2 minutes
- You'll get a URL like: `photoandmoto.pages.dev`
- Test everything!

---

## Step 4: Test Your Site

Visit your staging URL and check:

- [ ] Homepage loads
- [ ] Gallery works (photos open in lightbox)
- [ ] Article displays correctly
- [ ] Navigation works
- [ ] Language switcher works
- [ ] Mobile view looks good

---

## Step 5: Add Your Domain (Optional)

### In Cloudflare Pages:

1. Click your project → **Custom domains**
2. Click **Set up a custom domain**
3. Enter: `photoandmoto.fi`
4. Follow DNS setup instructions

### In Your Domain Registrar:

Update nameservers to Cloudflare's (they'll show you which ones)

**DNS propagates in 24-48 hours**, but often works within minutes.

---

## Your Workflow Going Forward

### Add a New Gallery (15 minutes each)

```bash
# 1. Add photos
mkdir -p src/assets/galleries/enduro
cp ~/my-photos/*.jpg src/assets/galleries/enduro/

# 2. Generate manifest
npm run generate-gallery enduro

# 3. Preview
npm run dev

# 4. Deploy
git add .
git commit -m "Add Enduro gallery"
git push
```

**Auto-deploys in 2 minutes!**

### Add a New Article (20 minutes each)

```bash
# 1. Create file
touch src/content/articles/fi/my-new-article.md

# 2. Add frontmatter and content:
```

```yaml
---
title: "Your Title"
subtitle: "Optional subtitle"
author: "Matti Tarkkonen"
date: 2026-04-20
category: "MXGP"
tags: ["tag1", "tag2"]
featured_image: "/images/article-hero.jpg"
language: "fi"
---

Your article content in Markdown...
```

```bash
# 3. Preview
npm run dev

# 4. Deploy
git add .
git commit -m "Add new article"
git push
```

---

## Troubleshooting

### Build fails on Cloudflare?

Check build logs. Common issues:
- Missing images referenced in articles
- Invalid JSON in gallery manifests
- Typo in frontmatter dates

### Gallery not showing?

- Check that images are in correct folder
- Run `npm run generate-gallery <slug>` again
- Verify JSON is valid in `src/content/galleries/`

### Need to rebuild locally?

```bash
npm run build
npm run preview
```

---

## Get Help

- **Build issues:** Check GitHub Actions logs
- **Cloudflare:** Check Pages dashboard logs
- **Local dev:** Check terminal output from `npm run dev`

---

## Next Steps After Launch

1. Migrate remaining 7 galleries (~7 hours)
2. Migrate remaining 15-20 articles (~8 hours)
3. Add social media links
4. Set up analytics (Cloudflare Web Analytics - free!)
5. Add sitemap to Google Search Console

**Total migration time: ~15 hours** (at your own pace)

---

**Ready? Start with Step 1 - Push to GitHub!**
