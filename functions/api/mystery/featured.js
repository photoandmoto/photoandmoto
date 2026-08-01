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
    // s-maxage keeps it in Cloudflare's edge cache even though browsers only
    // hold it briefly, so a busy day is a handful of D1 reads rather than one
    // per visitor. stale-while-revalidate means the refresh never blocks anyone.
    'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  };

  try {
    // Total count of unidentified photos (status != 'identified' AND not already published)
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM photos
       WHERE status != 'identified'
         AND published_to_gallery_at IS NULL`
    ).first();
    const count = countRow ? (countRow.c || 0) : 0;

    // Two steps on purpose. The single-query version was
    //   SELECT id, thumb_data ... ORDER BY RANDOM() LIMIT 6
    // which looks harmless but is not: ORDER BY RANDOM() has to materialise and
    // sort every matching row *including the selected columns*, so SQLite pushed
    // each row's base64 thumb_data through the sorter before discarding all but
    // six of them. Every row of this table also carries a full base64 image_data
    // blob, so the scan was reading far more than it returned. Measured at ~9s
    // on the live landing page.
    //
    // Sorting ids alone is cheap; fetching six rows by primary key afterwards is
    // an indexed lookup. Same result, without dragging the blobs through a sort.
    const idRows = await env.DB.prepare(
      `SELECT id FROM photos
       WHERE status != 'identified'
         AND published_to_gallery_at IS NULL
         AND thumb_data IS NOT NULL
         AND thumb_data != ''
       ORDER BY RANDOM()
       LIMIT 6`
    ).all();

    const ids = (idRows.results || []).map(r => r.id);
    let photos = [];
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const rs = await env.DB.prepare(
        `SELECT id, thumb_data FROM photos WHERE id IN (${placeholders})`
      ).bind(...ids).all();
      photos = (rs.results || []).map(r => ({
        id: r.id,
        thumb_data: r.thumb_data,
      }));
    }

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
