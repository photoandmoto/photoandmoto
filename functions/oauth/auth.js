// GET /oauth/auth
//
// Starts the GitHub OAuth dance for Decap CMS.
// 1. Generates a random `state` for CSRF protection, stored in an HttpOnly cookie.
// 2. Redirects the browser to GitHub's authorize URL with our client_id, the
//    callback URL, scope=repo (Decap needs branch/contents write), and state.
// GitHub will redirect back to /oauth/callback with ?code=...&state=...
//
// Env vars:
//   OAUTH_GITHUB_CLIENT_ID  — GitHub OAuth App client ID
//   OAUTH_REDIRECT_URI      — optional override (defaults to <origin>/oauth/callback)

export async function onRequestGet({ request, env }) {
  if (!env.OAUTH_GITHUB_CLIENT_ID) {
    return new Response('OAUTH_GITHUB_CLIENT_ID not configured', { status: 500 });
  }

  const url = new URL(request.url);
  const redirectUri = env.OAUTH_REDIRECT_URI || `${url.origin}/oauth/callback`;

  const state = crypto.randomUUID();

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', env.OAUTH_GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'repo');
  authorizeUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': authorizeUrl.toString(),
      'Set-Cookie': `decap_oauth_state=${state}; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      'Cache-Control': 'no-store',
    },
  });
}
