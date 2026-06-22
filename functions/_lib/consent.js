// functions/_lib/consent.js
//
// Authoritative consent wording for Avustaja photo uploads (Lähetä kuva).
// The backend stores THIS server-side constant into photo_submissions.consent_text
// at submit time — never the client-supplied string — so the audit trail records
// exactly what the form presented and can't be tampered with. The Avustajat form
// (src/pages/fi/yleinen-kyna.astro) displays the identical text. If the wording
// ever changes, old records keep the literal string they were created with.

export const PHOTO_CONSENT_TEXT =
  'Minä omistan tämän kuvan käyttöoikeuden ja annan luvan sen julkaisemiseen Photo & Moto -sivustolla.';

export const CONSENT_PHOTO_TEXT =
  'Vakuutan, että minulla on oikeudet lähettämiini kuviin ja annan Photo & Motolle oikeuden käyttää niitä tässä artikkelissa. Olen itse vastuussa luvattomasta materiaalista.';

export const CONSENT_CONTENT_TEXT =
  'Vakuutan, että tämän artikkelin sisältö on totta, eikä se loukkaa muiden tekijänoikeuksia. Olen itse vastuussa luvattomasta materiaalista.';
