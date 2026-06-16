// GET /images/<path> — serve objects from the UPLOADS R2 bucket (Yleinen Kynä
// contributor uploads). Cloudflare Pages serves committed static assets under
// /images/ first, so this function only runs for paths that have NO static
// asset — i.e. the R2-stored uploads. Existing public/images/* files are
// unaffected.

export async function onRequestGet({ params, env }) {
  if (!env.UPLOADS) return new Response('Not found', { status: 404 });

  // [[path]] catch-all → params.path is an array of segments (or a string).
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const key = parts.filter(Boolean).join('/');
  if (!key) return new Response('Not found', { status: 404 });

  const object = await env.UPLOADS.get(key);
  if (!object || !object.body) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);                 // Content-Type etc. from R2 metadata
  headers.set('ETag', object.httpEtag);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
}
