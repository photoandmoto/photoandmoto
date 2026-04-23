// POST /api/mystery/vote — upvote or downvote a comment (public)
export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const { comment_id, vote } = await request.json();
    if (!comment_id || ![-1, 1].includes(vote)) {
      return new Response(JSON.stringify({ error: 'Virheellinen äänestys' }), { status: 400, headers: corsHeaders });
    }

    const col = vote === 1 ? 'upvotes' : 'downvotes';
    await env.DB.prepare(`UPDATE comments SET ${col} = ${col} + 1 WHERE id = ?`).bind(comment_id).run();

    const updated = await env.DB.prepare('SELECT upvotes, downvotes FROM comments WHERE id = ?').bind(comment_id).first();

    return new Response(JSON.stringify({ success: true, upvotes: updated.upvotes, downvotes: updated.downvotes }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
