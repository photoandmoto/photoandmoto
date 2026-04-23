// POST /api/mystery/verify — verify admin password
export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const { password } = await request.json();
    if (!password || password !== env.UPLOAD_PASSWORD) {
      return new Response(JSON.stringify({ valid: false }), { status: 401, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ valid: true }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ valid: false, error: err.message }), { status: 500, headers: corsHeaders });
  }
}
export async function onRequestOptions() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
