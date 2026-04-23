// POST /api/mystery/comment — add a comment to a mystery photo (public)
export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { photo_id, author_name, content } = await request.json();

    if (!photo_id || !content || content.trim().length < 2) {
      return new Response(JSON.stringify({ error: 'Kommentti on liian lyhyt' }), { status: 400, headers: corsHeaders });
    }

    const name = (author_name || 'Nimetön').trim().substring(0, 100);
    const text = content.trim().substring(0, 2000);

    // Verify photo exists
    const photo = await env.DB.prepare('SELECT id FROM photos WHERE id = ?').bind(photo_id).first();
    if (!photo) {
      return new Response(JSON.stringify({ error: 'Kuvaa ei löytynyt' }), { status: 404, headers: corsHeaders });
    }

    const result = await env.DB.prepare(
      `INSERT INTO comments (photo_id, author_name, content) VALUES (?, ?, ?)`
    ).bind(photo_id, name, text).run();

    // If comment contains identification info, update photo status to 'partial'
    const photo_data = await env.DB.prepare('SELECT status FROM photos WHERE id = ?').bind(photo_id).first();
    if (photo_data.status === 'new') {
      await env.DB.prepare(
        `UPDATE photos SET status = 'partial' WHERE id = ?`
      ).bind(photo_id).run();
    }

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id,
      message: 'Kommentti lisätty'
    }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
