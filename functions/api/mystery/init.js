export async function onRequestPost(context) {
  const { env } = context;
  const h = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, content_type TEXT DEFAULT 'image/jpeg', image_data TEXT NOT NULL, year_estimate TEXT DEFAULT '', people TEXT DEFAULT '', location_notes TEXT DEFAULT '', notes TEXT DEFAULT '', status TEXT DEFAULT 'new', created_at TEXT DEFAULT (datetime('now')))`).run();

    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, photo_id INTEGER NOT NULL, parent_id INTEGER DEFAULT NULL, author_name TEXT DEFAULT 'Nimetön', field_type TEXT DEFAULT 'general', content TEXT NOT NULL, upvotes INTEGER DEFAULT 0, downvotes INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (photo_id) REFERENCES photos(id))`).run();

    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_comments_photo ON comments(photo_id)`).run();
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status)`).run();

    // Migrations for existing tables
    const migs = [
      `ALTER TABLE comments ADD COLUMN field_type TEXT DEFAULT 'general'`,
      `ALTER TABLE comments ADD COLUMN upvotes INTEGER DEFAULT 0`,
      `ALTER TABLE comments ADD COLUMN downvotes INTEGER DEFAULT 0`,
      `ALTER TABLE comments ADD COLUMN parent_id INTEGER DEFAULT NULL`,
    ];
    for (const sql of migs) { try { await env.DB.prepare(sql).run(); } catch(e) {} }

    return new Response(JSON.stringify({ success: true }), { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: h });
  }
}
