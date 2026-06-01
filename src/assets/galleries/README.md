# Adding Photos to Galleries

> Note: gallery image files live in **`public/galleries/<slug>/`** — not in
> this `src/assets/galleries/` folder. This README is just the how-to.

There are two ways photos get into a gallery:

1. **Via the admin** — the `/fi/yllapito` "Julkaise Galleriaan" flow publishes
   an identified mystery photo into a gallery automatically. See the gallery
   publishing pipeline in the root `README.md`.
2. **Manually / bulk import** — for adding a folder of photos at once. That's
   what this guide covers.

## Current galleries

Each gallery is a folder under `public/galleries/`:

| Folder | Gallery |
|---|---|
| `international-70s/` | International 70s |
| `international-80s/` | International 80s |
| `international-90s/` | International 90s |
| `suomi-70s/` | Suomi 70s |
| `suomi-80s/` | Suomi 80s |
| `suomi-90s/` | Suomi 90s |
| `hyvinkaa-scramble/` | Hyvinkää Scramble |

The category (`international`, `finland`, `enduro`, `scramble`, `black-white`)
is derived from the slug automatically.

## Adding photos manually

### 1. Copy photos into the gallery folder

```bash
# Example: adding to International 70s
cp ~/Downloads/my-photos/*.jpg public/galleries/international-70s/
```

For a brand-new gallery, just create the folder:
`mkdir -p public/galleries/my-new-gallery`.

### 2. Generate thumbnails, display versions, and manifest

```bash
npm run generate-gallery international-70s
```

This runs `scripts/generate-gallery-manifest.mjs`, which:

- Generates a **600px thumbnail** per photo (no watermark) → `thumbs/`
- Generates a **1400px display version** per photo (with `© Photo & Moto`
  watermark) → `display/`
- Writes/updates the manifest at
  `src/content/galleries/international-70s.json`

### 3. Preview

```bash
npm run dev
```

Visit `http://localhost:4321/fi/galleria/international-70s`.

### 4. Deploy

```bash
git add public/galleries/international-70s src/content/galleries/international-70s.json
git commit -m "Add photos to International 70s"
git push
```

## Image guidelines

- **Format:** JPG, PNG, or WebP
- **Size:** 1200–2000px wide works well (display version is capped at 1400px)
- **File names:** descriptive — the filename becomes the default caption
  (underscores become spaces). A year in the filename (e.g. `... 1978.jpg`) is
  used for chronological sorting.

## Editing captions

After generating, captions can be edited directly in
`src/content/galleries/<slug>.json`. Manifest shape:

```json
{
  "title": "International 70s",
  "slug": "international-70s",
  "description": "Photo gallery: International 70s",
  "cover_image": "thumbs/photo-001_thumb.jpg",
  "images": [
    {
      "filename": "photo-001.jpg",
      "thumb": "thumbs/photo-001_thumb.jpg",
      "display": "display/photo-001_display.jpg",
      "caption": "Edit your caption here",
      "photographer": "",
      "date": "",
      "width": 1400,
      "height": 933
    }
  ],
  "category": "international"
}
```

Images are sorted by year (parsed from the caption/filename), then
alphabetically. To force a specific order, prefix filenames with numbers
(`01-start.jpg`, `02-jump.jpg`).
