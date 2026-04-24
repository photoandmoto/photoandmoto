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
        // Derive status from core fields (notes is optional). Don't resurrect archived photos.
        const cur = await env.DB.prepare('SELECT status FROM photos WHERE id=?').bind(photo_id).first();
        const core = [year_estimate, people, location_notes];
        const filled = core.filter(f => f && String(f).trim()).length;
        let status;
        if (cur && cur.status === 'archived') {
          status = 'archived';
        } else {
          status = filled === 0 ? 'new' : filled < 3 ? 'partial' : 'identified';
        }
        await env.DB.prepare(`UPDATE photos SET year_estimate=?,people=?,location_notes=?,notes=?,status=? WHERE id=?`)
          .bind(year_estimate||'', people||'', location_notes||'', notes||'', status, photo_id).run();
        return new Response(JSON.stringify({ success: true, status }), { headers: h });
      }
      case 'set_status': {
        const { photo_id, status } = body;
        if (!['new','partial','identified','archived'].includes(status))
          return new Response(JSON.stringify({ error: 'Virhe' }), { status: 400, headers: h });
        await env.DB.prepare('UPDATE photos SET status=? WHERE id=?').bind(status, photo_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: h });
      }
      case 'reclassify_comment': {
        const { comment_id, field_type } = body;
        const allowed = ['general','year','people','location','notes'];
        const ft = allowed.includes(field_type) ? field_type : 'general';
        await env.DB.prepare('UPDATE comments SET field_type=? WHERE id=?').bind(ft, comment_id).run();
        return new Response(JSON.stringify({ success: true, field_type: ft }), { headers: h });
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
