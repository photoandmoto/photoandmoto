// POST /api/mystery/admin — admin actions (password protected)
export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = await request.json();
    if (!body.password || body.password !== env.UPLOAD_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Väärä salasana' }), { status: 401, headers: corsHeaders });
    }

    const { action, photo_id, comment_id } = body;

    switch (action) {
      case 'update_meta': {
        const { year_estimate, people, location_notes, notes } = body;
        await env.DB.prepare(
          `UPDATE photos SET year_estimate = ?, people = ?, location_notes = ?, notes = ? WHERE id = ?`
        ).bind(year_estimate || '', people || '', location_notes || '', notes || '', photo_id).run();
        return new Response(JSON.stringify({ success: true, message: 'Tiedot päivitetty' }), { headers: corsHeaders });
      }

      case 'set_status': {
        const { status } = body;
        if (!['new', 'partial', 'identified', 'archived'].includes(status)) {
          return new Response(JSON.stringify({ error: 'Virheellinen tila' }), { status: 400, headers: corsHeaders });
        }
        await env.DB.prepare('UPDATE photos SET status = ? WHERE id = ?').bind(status, photo_id).run();
        return new Response(JSON.stringify({ success: true, message: `Tila: ${status}` }), { headers: corsHeaders });
      }

      case 'delete_photo': {
        await env.DB.prepare('DELETE FROM comments WHERE photo_id = ?').bind(photo_id).run();
        await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(photo_id).run();
        return new Response(JSON.stringify({ success: true, message: 'Kuva poistettu' }), { headers: corsHeaders });
      }

      case 'delete_comment': {
        if (!comment_id) return new Response(JSON.stringify({ error: 'comment_id puuttuu' }), { status: 400, headers: corsHeaders });
        await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(comment_id).run();
        return new Response(JSON.stringify({ success: true, message: 'Kommentti poistettu' }), { headers: corsHeaders });
      }

      default:
        return new Response(JSON.stringify({ error: 'Tuntematon toiminto' }), { status: 400, headers: corsHeaders });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
