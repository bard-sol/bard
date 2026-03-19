// BARD AUTH WORKER — X OAuth 2.0
// Environment variables needed:
// X_CLIENT_ID = RmFkRXhodGFueGVXZXJvN3hSOVY6MTpjaQ
// X_CLIENT_SECRET = (your secret from X developer portal)
// SUPABASE_URL = https://pxdiyukxgnphxlknhmke.supabase.co
// SUPABASE_ANON = (your supabase anon key)

const CORS = {
  'Access-Control-Allow-Origin': 'https://bard.is',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // Route: /auth/x/start — return OAuth URL as JSON so browser does the redirect
    if (url.pathname === '/auth/x/start') {
      const wallet = url.searchParams.get('wallet') || '';
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = btoa(JSON.stringify({ wallet, ts: Date.now(), cv: codeVerifier }));

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: env.X_CLIENT_ID,
        redirect_uri: 'https://bard-auth.bardsoltoken.workers.dev/auth/x/callback',
        scope: 'tweet.read users.read offline.access',
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      const authUrl = `https://x.com/i/oauth2/authorize?${params}`;

      // Return URL and code verifier to browser — browser does the redirect
      return new Response(JSON.stringify({ authUrl, codeVerifier }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Route: /auth/x/callback — exchange code for token
    if (url.pathname === '/auth/x/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error || !code) {
        return Response.redirect('https://bard.is/dashboard.html?auth=error', 302);
      }

      // Get code verifier from state (we embed it there since no cookie cross-origin)
      let codeVerifier = '';
      let wallet = '';
      try {
        const decoded = JSON.parse(atob(state));
        wallet = decoded.wallet || '';
        codeVerifier = decoded.cv || '';
      } catch (e) {}

      if (!codeVerifier) {
        return Response.redirect('https://bard.is/dashboard.html?auth=error', 302);
      }



      // Exchange code for access token
      const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`),
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: 'https://bard-auth.bardsoltoken.workers.dev/auth/x/callback',
          code_verifier: codeVerifier,
        }),
      });

      const tokenData = await tokenRes.json();

      if (!tokenData.access_token) {
        return Response.redirect('https://bard.is/dashboard.html?auth=error', 302);
      }

      // Get user info from X
      const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=username,name,profile_image_url', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
      });

      const userData = await userRes.json();
      const xHandle = userData.data?.username || '';
      const xId = userData.data?.id || '';

      // Save to Supabase
      if (wallet && xHandle) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/members`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': env.SUPABASE_ANON,
            'Authorization': `Bearer ${env.SUPABASE_ANON}`,
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({
            wallet_address: wallet,
            x_handle: '@' + xHandle,
            x_id: xId,
            last_seen: new Date().toISOString(),
          }),
        });
      }

      // Redirect back to dashboard with success
      return Response.redirect(
        `https://bard.is/dashboard.html?auth=success&handle=${xHandle}&wallet=${wallet}`,
        302
      );
    }

    return new Response('Not found', { status: 404 });
  }
};

// ─── PKCE HELPERS ──────────────────────────────────────────────────────────
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
