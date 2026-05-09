# Translation Glossary — Site-specific overrides

This file is read by `scripts/translate-article.mjs` and passed to Gemini.
It exists ONLY for terms specific to Photo & Moto that Gemini might
mistranslate or fail to recognize. The translator script's main prompt
already tells Gemini to:

  - Preserve all proper nouns (rider names, place names, brand names)
  - Preserve sport-specific terms (MXGP, FIM, motocross, speedway, etc.)
  - Preserve class designations (50cc, 125cc, etc.)
  - Preserve markdown structure, image paths, URLs, code blocks

So you do NOT need to list every motorcycle brand or rider here. Add an
entry only when you've caught Gemini getting something wrong on a real
article, and you want to lock it in. Format: `Source -> Target`. One per line.

## Examples (delete or replace)

- Sandblowers -> Sandblowers
- Photo & Moto -> Photo & Moto
