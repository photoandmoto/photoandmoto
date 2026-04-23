export async function onRequestPost(context) {
  const { env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, content_type TEXT DEFAULT 'image/jpeg', image_data TEXT NOT NULL, uploader_name TEXT NOT NULL, year_estimate TEXT DEFAULT '', people TEXT DEFAULT '', location_notes TEXT DEFAULT '', notes TEXT DEFAULT '', status TEXT DEFAULT 'new', created_at TEXT DEFAULT (datetime('now')))`).run();

    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, photo_id INTEGER NOT NULL, author_name TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (photo_id) REFERENCES photos(id))`).run();

    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_comments_photo ON comments(photo_id)`).run();

    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status)`).run();

    return new Response(JSON.stringify({ success: true, message: 'Database initialized' }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
