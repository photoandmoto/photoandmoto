// GET /api/mystery/photos — list all mystery photos with their comments
export async function onRequestGet(context) {
  const { env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    // Get all non-archived photos, newest first
    const photos = await env.DB.prepare(
      `SELECT * FROM photos WHERE status != 'archived' ORDER BY created_at DESC`
    ).all();

    // Get all comments for these photos
    const comments = await env.DB.prepare(
      `SELECT * FROM comments ORDER BY created_at ASC`
    ).all();

    // Group comments by photo_id
    const commentsByPhoto = {};
    for (const c of comments.results) {
      if (!commentsByPhoto[c.photo_id]) commentsByPhoto[c.photo_id] = [];
      commentsByPhoto[c.photo_id].push(c);
    }

    // Attach comments to photos
    const result = photos.results.map(p => ({
      ...p,
      image_url: `/api/mystery/image/${p.r2_key.replace('photos/', '')}`,
      comments: commentsByPhoto[p.id] || []
    }));

    return new Response(JSON.stringify({ photos: result }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
