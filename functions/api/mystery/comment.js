export async function onRequestPost(context) {
  const { request, env } = context;
  const h = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const { photo_id, author_name, content, field_type, parent_id } = await request.json();
    if (!photo_id || !content || content.trim().length < 2)
      return new Response(JSON.stringify({ error: 'Liian lyhyt' }), { status: 400, headers: h });

    const name = (author_name || 'Nimetön').trim().substring(0, 100);
    const text = content.trim().substring(0, 2000);
    const field = ['general','year','people','location','notes'].includes(field_type) ? field_type : 'general';
    const pid = parent_id ? parseInt(parent_id) : null;

    const r = await env.DB.prepare(
      `INSERT INTO comments (photo_id,author_name,field_type,content,parent_id) VALUES (?,?,?,?,?)`
    ).bind(photo_id, name, field, text, pid).run();

    // Auto-update status to partial
    const photo = await env.DB.prepare('SELECT status FROM photos WHERE id = ?').bind(photo_id).first();
    if (photo && photo.status === 'new')
      await env.DB.prepare(`UPDATE photos SET status = 'partial' WHERE id = ?`).bind(photo_id).run();

    return new Response(JSON.stringify({ success: true, id: r.meta.last_row_id }), { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: h });
  }
}
export async function onRequestOptions() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
