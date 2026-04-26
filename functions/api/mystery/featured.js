// /api/mystery/featured
//
// Public endpoint used by the landing-page "Help needed" block.
// Returns up to 6 random unidentified mystery photos with their browser-generated
// thumbnails, plus a total count of how many unidentified photos exist.
//
// Response shape:
//   {
//     count: 47,                              // total unidentified photos (any with thumb_data or not)
//     photos: [                                // up to 6 photos that have thumb_data
//       { id: 123, thumb_data: "data:..." }
//     ]
//   }
//
// If count === 0, the landing page block hides itself entirely.
// If count > 0 but photos is empty (legacy rows without thumbs yet), block still shows count + CTA.

export async function onRequestGet(context) {
  const { env } = context;
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    // Cache for 60s on the edge — this endpoint hits the landing page on every visit,
    // and the answer barely changes. Reduces D1 load for high-traffic days.
    'Cache-Control': 'public, max-age=60',
  };

  try {
    // Total count of unidentified photos (status != 'identified' AND not already published)
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM photos
       WHERE status != 'identified'
         AND published_to_gallery_at IS NULL`
    ).first();
    const count = countRow ? (countRow.c || 0) : 0;

    // Pull up to 6 random photos that have a thumb_data value.
    // ORDER BY RANDOM() works on D1 (SQLite) and at this scale (hundreds of rows) is fine.
    const rs = await env.DB.prepare(
      `SELECT id, thumb_data FROM photos
       WHERE status != 'identified'
         AND published_to_gallery_at IS NULL
         AND thumb_data IS NOT NULL
         AND thumb_data != ''
       ORDER BY RANDOM()
       LIMIT 6`
    ).all();

    const photos = (rs.results || []).map(r => ({
      id: r.id,
      thumb_data: r.thumb_data,
    }));

    return new Response(JSON.stringify({ count, photos }), { headers: h });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, count: 0, photos: [] }), { status: 500, headers: h });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
