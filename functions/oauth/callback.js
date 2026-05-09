// GET /oauth/callback
//
// GitHub redirects here after the user approves the OAuth app.
// 1. Validates the `state` query param against the cookie set by /oauth/auth.
// 2. Exchanges the `code` for an access token via GitHub's token endpoint.
// 3. Returns an HTML page that postMessages the token back to the Decap admin
//    window (which opened this popup) and then closes itself.
//
// Decap's expected message protocol:
//   popup -> opener: "authorizing:github"
//   opener -> popup: any message (acks listener is ready)
//   popup -> opener: "authorization:github:success:{json}"
//
// Env vars:
//   OAUTH_GITHUB_CLIENT_ID
//   OAUTH_GITHUB_CLIENT_SECRET

export async function onRequestGet({ request, env }) {
  if (!env.OAUTH_GITHUB_CLIENT_ID || !env.OAUTH_GITHUB_CLIENT_SECRET) {
    return errorPage('OAuth secrets not configured on the server.');
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    const desc = url.searchParams.get('error_description') || oauthError;
    return errorPage(`GitHub returned an error: ${desc}`);
  }
  if (!code) {
    return errorPage('Missing `code` parameter from GitHub.');
  }

  // CSRF: state must match the value we set in the cookie at /oauth/auth.
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookieState = (cookieHeader.match(/(?:^|;\s*)decap_oauth_state=([^;]+)/) || [])[1];
  if (!cookieState || !state || cookieState !== state) {
    return errorPage('State mismatch — possible CSRF, or the login attempt timed out. Try logging in again.');
  }

  // Exchange code for access token.
  let token;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'photoandmoto-decap-oauth',
      },
      body: JSON.stringify({
        client_id: env.OAUTH_GITHUB_CLIENT_ID,
        client_secret: env.OAUTH_GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return errorPage(`Token exchange failed (${tokenRes.status}): ${text}`);
    }
    const data = await tokenRes.json();
    if (data.error) {
      return errorPage(`GitHub: ${data.error_description || data.error}`);
    }
    token = data.access_token;
    if (!token) {
      return errorPage('GitHub did not return an access_token.');
    }
  } catch (e) {
    return errorPage(`Token exchange threw: ${e.message}`);
  }

  // The payload Decap parses out of the success message.
  const payload = JSON.stringify({ token, provider: 'github' });

  // Embed payload inside a JS string literal — JSON.stringify(payload) handles
  // escaping for us (the token is URL-safe but we still escape defensively).
  const html = `<!doctype html>
<html lang="fi"><head><meta charset="utf-8"><title>Kirjautuminen valmis…</title>
<meta name="robots" content="noindex">
<style>body{font-family:system-ui,sans-serif;padding:2rem;color:#333}</style>
</head><body>
<p>Kirjautuminen valmis. Tämä ikkuna sulkeutuu hetken kuluttua.</p>
<script>
(function() {
  var payload = ${JSON.stringify(payload)};
  function send(msg, origin) {
    if (window.opener) window.opener.postMessage(msg, origin || '*');
  }
  window.addEventListener('message', function(e) {
    if (typeof e.data !== 'string' || e.data.indexOf('authorizing:') !== 0) return;
    send('authorization:github:success:' + payload, e.origin);
    setTimeout(function(){ window.close(); }, 100);
  }, false);
  // Wake the opener up so it sets up its listener and replies.
  send('authorizing:github', '*');
})();
</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // Clear the state cookie — it's single-use.
      'Set-Cookie': 'decap_oauth_state=; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  });
}

function errorPage(msg) {
  const safe = String(msg).replace(/[<>&"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;',
  })[c]);
  const html = `<!doctype html>
<html lang="fi"><head><meta charset="utf-8"><title>OAuth-virhe</title>
<meta name="robots" content="noindex">
<style>body{font-family:system-ui,sans-serif;padding:2rem;color:#333;max-width:640px}
h1{color:#b00020}</style>
</head><body>
<h1>OAuth-virhe</h1>
<p>${safe}</p>
<p><a href="/admin/">Takaisin Decapiin</a></p>
</body></html>`;
  return new Response(html, {
    status: 400,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
