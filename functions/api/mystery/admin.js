export async function onRequestPost(context) {
  const { request, env } = context;
  const h = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const body = await request.json();
    if (!body.password || body.password !== env.UPLOAD_PASSWORD)
      return new Response(JSON.stringify({ error: 'Väärä salasana' }), { status: 401, headers: h });

    switch (body.action) {
      case 'update_meta': {
        const { photo_id, year_estimate, people, location_notes, notes } = body;
        await env.DB.prepare(`UPDATE photos SET year_estimate=?,people=?,location_notes=?,notes=? WHERE id=?`)
          .bind(year_estimate||'',people||'',location_notes||'',notes||'',photo_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: h });
      }
      case 'set_status': {
        const { photo_id, status } = body;
        if (!['new','partial','identified','archived'].includes(status))
          return new Response(JSON.stringify({ error: 'Virhe' }), { status: 400, headers: h });
        await env.DB.prepare('UPDATE photos SET status=? WHERE id=?').bind(status, photo_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: h });
      }
      case 'delete_photo': {
        await env.DB.prepare('DELETE FROM comments WHERE photo_id=?').bind(body.photo_id).run();
        await env.DB.prepare('DELETE FROM photos WHERE id=?').bind(body.photo_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: h });
      }
      case 'delete_comment': {
        // Delete comment and its replies
        await env.DB.prepare('DELETE FROM comments WHERE parent_id=?').bind(body.comment_id).run();
        await env.DB.prepare('DELETE FROM comments WHERE id=?').bind(body.comment_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: h });
      }
      default:
        return new Response(JSON.stringify({ error: 'Tuntematon' }), { status: 400, headers: h });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: h });
  }
}
export async function onRequestOptions() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
