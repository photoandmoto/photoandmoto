// GET /api/mystery/image/:id — serve image from D1 base64
export async function onRequestGet(context) {
  const { env, params } = context;
  const id = parseInt(params.id);

  try {
    const photo = await env.DB.prepare(
      'SELECT image_data, content_type FROM photos WHERE id = ?'
    ).bind(id).first();

    if (!photo) {
      return new Response('Not found', { status: 404 });
    }

    // Decode base64 to binary
    const binaryString = atob(photo.image_data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new Response(bytes, {
      headers: {
        'Content-Type': photo.content_type || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      }
    });
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}
