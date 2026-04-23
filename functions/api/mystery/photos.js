export async function onRequestGet(context) {
  const { env } = context;
  const h = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const photos = await env.DB.prepare(
      `SELECT id,filename,content_type,year_estimate,people,location_notes,notes,status,created_at FROM photos WHERE status NOT IN ('archived','identified') ORDER BY created_at DESC`
    ).all();
    const comments = await env.DB.prepare(`SELECT * FROM comments ORDER BY created_at ASC`).all();
    const byPhoto = {};
    for (const c of comments.results) {
      if (!byPhoto[c.photo_id]) byPhoto[c.photo_id] = [];
      byPhoto[c.photo_id].push(c);
    }
    const result = photos.results.map(p => ({
      ...p, image_url: `/api/mystery/image/${p.id}`, comments: byPhoto[p.id] || []
    }));
    return new Response(JSON.stringify({ photos: result }), { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: h });
  }
}
