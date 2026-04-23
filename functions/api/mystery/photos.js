// GET /api/mystery/photos — list all mystery photos with comments (no image data)
export async function onRequestGet(context) {
  const { env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    // Get all non-archived photos, newest first — exclude image_data for speed
    const photos = await env.DB.prepare(
      `SELECT id, filename, content_type, uploader_name, year_estimate, people, location_notes, notes, status, created_at
       FROM photos WHERE status != 'archived' ORDER BY created_at DESC`
    ).all();

    // Get all comments
    const comments = await env.DB.prepare(
      `SELECT * FROM comments ORDER BY created_at ASC`
    ).all();

    // Group comments by photo_id
    const commentsByPhoto = {};
    for (const c of comments.results) {
      if (!commentsByPhoto[c.photo_id]) commentsByPhoto[c.photo_id] = [];
      commentsByPhoto[c.photo_id].push(c);
    }

    // Attach comments and image URL
    const result = photos.results.map(p => ({
      ...p,
      image_url: `/api/mystery/image/${p.id}`,
      comments: commentsByPhoto[p.id] || []
    }));

    return new Response(JSON.stringify({ photos: result }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
