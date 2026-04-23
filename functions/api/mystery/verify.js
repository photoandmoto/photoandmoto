export async function onRequestPost(context) {
  const { request, env } = context;
  const h = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const { password } = await request.json();
    const valid = password && password === env.UPLOAD_PASSWORD;
    return new Response(JSON.stringify({ valid }), { status: valid ? 200 : 401, headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ valid: false }), { status: 500, headers: h });
  }
}
export async function onRequestOptions() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
