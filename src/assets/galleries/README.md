# How to Add Photos to Galleries

## Quick Start

Each gallery folder corresponds to a gallery on your site:

- `international-i/` → International I
- `international-ii/` → International II  
- `international-iii/` → International III
- `suomi-i/` → Suomi I
- `suomi-ii/` → Suomi II
- `enduro/` → Enduro
- `scramble/` → Scramble
- `black-white/` → Black & White

## Adding Photos

### Step 1: Copy Photos to Folder

```bash
# Example: Adding to International I
cp ~/Downloads/my-photos/*.jpg src/assets/galleries/international-i/
```

### Step 2: Generate Manifest

```bash
npm run generate-gallery international-i
```

This creates: `src/content/galleries/international-i.json`

### Step 3: Preview

```bash
npm run dev
```

Visit: `http://localhost:4321/fi/galleria/international-i`

### Step 4: Deploy

```bash
git add .
git commit -m "Add photos to International I"
git push
```

## Image Guidelines

- **Format:** JPG, PNG, or WebP
- **Size:** 1200-2000px wide (will be auto-optimized)
- **File names:** Use descriptive names (e.g., `mxgp-start-2026.jpg`)
- **Quantity:** 50-150 photos per gallery works well

## Tips

- Start with your best 10-15 photos per gallery
- Add captions by editing the generated JSON file
- Photos are displayed in alphabetical order by filename
- Rename files with numbers to control order: `01-start.jpg`, `02-jump.jpg`, etc.

## Example Gallery JSON

After running the generator, you can edit captions:

```json
{
  "title": "International I",
  "slug": "international-i",
  "description": "Photo gallery: International I",
  "cover_image": "photo-001.jpg",
  "images": [
    {
      "filename": "photo-001.jpg",
      "caption": "Add your caption here",
      "photographer": "Matti Tarkkonen",
      "date": "2024-06-15",
      "width": 1920,
      "height": 1280
    }
  ],
  "category": "international"
}
```

**That's it! Repeat for each of your 8 galleries.**
