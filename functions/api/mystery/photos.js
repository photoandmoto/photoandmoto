export async function onRequestGet(context) {
  const { request, env } = context;
  const h = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const url = new URL(request.url);
    const includeAll = url.searchParams.get('include') === 'all';
    // Community default: hide archived + identified. Admin (?include=all): only hide archived.
    const whereSql = includeAll
      ? `WHERE status != 'archived'`
      : `WHERE status NOT IN ('archived','identified')`;
    const photos = await env.DB.prepare(
      `SELECT id,filename,content_type,year_estimate,people,location_notes,notes,status,created_at FROM photos ${whereSql} ORDER BY created_at DESC`
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
