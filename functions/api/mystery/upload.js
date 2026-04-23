// POST /api/mystery/upload — password-protected photo upload
export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const formData = await request.formData();

    // Verify upload password
    const password = formData.get('password');
    if (!password || password !== env.UPLOAD_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Väärä salasana' }), { status: 401, headers: corsHeaders });
    }

    const file = formData.get('photo');
    if (!file || !file.size) {
      return new Response(JSON.stringify({ error: 'Kuvaa ei löytynyt' }), { status: 400, headers: corsHeaders });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff'];
    if (!allowedTypes.includes(file.type)) {
      return new Response(JSON.stringify({ error: 'Sallitut tiedostotyypit: JPEG, PNG, WEBP, TIFF' }), { status: 400, headers: corsHeaders });
    }

    // Max 20MB
    if (file.size > 20 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Tiedosto on liian suuri (max 20 MB)' }), { status: 400, headers: corsHeaders });
    }

    // Metadata from form
    const uploaderName = formData.get('uploader_name') || 'Tuntematon';
    const yearEstimate = formData.get('year_estimate') || '';
    const people = formData.get('people') || '';
    const locationNotes = formData.get('location_notes') || '';
    const notes = formData.get('notes') || '';

    // Generate unique R2 key
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const r2Key = `photos/${timestamp}_${safeName}`;

    // Store in R2
    await env.MYSTERY_PHOTOS.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    // Create DB record
    const result = await env.DB.prepare(
      `INSERT INTO photos (filename, r2_key, uploader_name, year_estimate, people, location_notes, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(file.name, r2Key, uploaderName, yearEstimate, people, locationNotes, notes).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id,
      message: 'Kuva ladattu onnistuneesti'
    }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Lataus epäonnistui: ' + err.message }), { status: 500, headers: corsHeaders });
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
