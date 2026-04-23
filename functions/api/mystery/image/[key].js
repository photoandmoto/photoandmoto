// GET /api/mystery/image/:key — serve image from R2
export async function onRequestGet(context) {
  const { env, params } = context;
  const key = `photos/${params.key}`;

  try {
    const object = await env.MYSTERY_PHOTOS.get(key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=86400');

    return new Response(object.body, { headers });
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}
