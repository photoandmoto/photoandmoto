// POST /api/mystery/upload — password-protected photo upload, stores base64 in D1
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
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return new Response(JSON.stringify({ error: 'Sallitut tiedostotyypit: JPEG, PNG, WEBP' }), { status: 400, headers: corsHeaders });
    }

    // Max 5MB
    if (file.size > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Tiedosto on liian suuri (max 5 MB)' }), { status: 400, headers: corsHeaders });
    }

    // Convert to base64 in chunks (avoids stack overflow)
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    const base64 = btoa(binary);

    // Metadata from form
    const uploaderName = formData.get('uploader_name') || 'Tuntematon';
    const yearEstimate = formData.get('year_estimate') || '';
    const people = formData.get('people') || '';
    const locationNotes = formData.get('location_notes') || '';
    const notes = formData.get('notes') || '';

    // Store in D1
    const result = await env.DB.prepare(
      `INSERT INTO photos (filename, content_type, image_data, uploader_name, year_estimate, people, location_notes, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(file.name, file.type, base64, uploaderName, yearEstimate, people, locationNotes, notes).run();

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
