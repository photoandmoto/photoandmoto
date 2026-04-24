export async function onRequestPost(context) {
  const { request, env } = context;
  const h = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const fd = await request.formData();
    if (!fd.get('password') || fd.get('password') !== env.UPLOAD_PASSWORD)
      return new Response(JSON.stringify({ error: 'Väärä salasana' }), { status: 401, headers: h });
    const file = fd.get('photo');
    if (!file || !file.size) return new Response(JSON.stringify({ error: 'Kuvaa ei löytynyt' }), { status: 400, headers: h });
    if (!['image/jpeg','image/png','image/webp'].includes(file.type))
      return new Response(JSON.stringify({ error: 'Sallitut: JPEG, PNG, WEBP' }), { status: 400, headers: h });
    if (file.size > 5*1024*1024)
      return new Response(JSON.stringify({ error: 'Max 5 MB' }), { status: 400, headers: h });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    // uploader_name is NOT NULL in schema; only admin can upload for now, so default to 'Ylläpito'.
    const r = await env.DB.prepare(
      `INSERT INTO photos (filename,content_type,image_data,uploader_name,year_estimate,people,location_notes,notes) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      file.name,
      file.type,
      btoa(bin),
      'Ylläpito',
      fd.get('year_estimate')||'',
      fd.get('people')||'',
      fd.get('location_notes')||'',
      fd.get('notes')||''
    ).run();
    return new Response(JSON.stringify({ success: true, id: r.meta.last_row_id }), { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: h });
  }
}
export async function onRequestOptions() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
