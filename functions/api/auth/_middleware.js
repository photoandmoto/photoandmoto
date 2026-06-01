// functions/api/auth/_middleware.js
//
// Cloudflare Pages Functions middleware for the /api/auth/* tree.
// Catches any unhandled exception in downstream handlers and returns it as
// JSON instead of letting Cloudflare's bare "error code: 1101" page leak through.
//
// In production, we strip the stack trace from the response so internal
// details aren't exposed — but the full error is always logged to
// the Cloudflare Workers console (visible in Real-time logs).

export async function onRequest(context) {
  try {
    return await context.next();
  } catch (err) {
    const message = err?.message || 'Tuntematon virhe';
    const stack = err?.stack || '';
    console.error('AUTH ENDPOINT ERROR:', err);
    console.error('Stack:', stack);

    return new Response(
      JSON.stringify({
        error: message,
        // Include stack only on non-prod environments so debug is fast.
        // CF_PAGES_BRANCH === 'main' means production; anything else is staging/preview.
        ...(context.env?.CF_PAGES_BRANCH !== 'main' ? { stack } : {}),
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
