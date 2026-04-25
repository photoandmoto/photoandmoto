// GET /api/mystery/galleries
//
// Returns the list of available galleries for the Tunnista kuva → Julkaise modal.
// Admin auth required (password in query string or header), to keep the endpoint
// out of public reach since it's an internal admin tool.
//
// Response shape:
//   { galleries: [ { slug, title }, ... ] }
//
// Source of truth: a hardcoded list maintained here. Adding a new gallery via
// the publish endpoint (B7) does NOT auto-update this list — admin should add
// the new slug here when promoting infrastructure changes. For day-to-day
// publishing into existing galleries, this list does not need to change.

const GALLERIES = [
  { slug: 'hyvinkaa-scramble', title: 'Hyvinkaa Scramble' },
  { slug: 'international-70s', title: 'International 70s' },
  { slug: 'international-80s', title: 'International 80s' },
  { slug: 'international-90s', title: 'International 90s' },
  { slug: 'suomi-70s',         title: 'Suomi 70s' },
  { slug: 'suomi-80s',         title: 'Suomi 80s' },
  { slug: 'suomi-90s',         title: 'Suomi 90s' },
];

function unauthorized(message = 'Unauthorized') {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestGet({ request, env }) {
  // Read password from either the X-Admin-Password header or ?password= query.
  // Both are accepted so the frontend can pick whichever is convenient.
  const url = new URL(request.url);
  const provided =
    request.headers.get('X-Admin-Password') ||
    url.searchParams.get('password') ||
    '';

  if (!env.UPLOAD_PASSWORD) {
    return new Response(
      JSON.stringify({ error: 'Server not configured (UPLOAD_PASSWORD missing)' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (provided !== env.UPLOAD_PASSWORD) {
    return unauthorized();
  }

  return ok({ galleries: GALLERIES });
}
