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

    // Route: /tweets/scan — search X for $BARD mentions and auto-log to points_log
    if (url.pathname === '/tweets/scan') {
      if (url.searchParams.get('secret') !== env.SCAN_SECRET) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      // Search X API — $BARD cashtag catches $BARD/$Bard/$bard; keyword "bard" catches Bard/bard
      const query = encodeURIComponent('($BARD OR bard) -is:retweet lang:en');
      const searchRes = await fetch(
        `https://api.twitter.com/2/tweets/search/recent?query=${query}&tweet.fields=author_id,created_at,text&expansions=author_id&user.fields=username&max_results=100`,
        { headers: { 'Authorization': `Bearer ${env.X_BEARER_TOKEN}` } }
      );
      const searchData = await searchRes.json();
      const tweets = searchData.data || [];
      const usersById = {};
      (searchData.includes?.users || []).forEach(u => { usersById[u.id] = u; });

      let logged = 0;
      for (const tweet of tweets) {
        const user = usersById[tweet.author_id];
        if (!user) continue;
        const xHandle = '@' + user.username;

        // Skip if tweet already logged
        const dupCheck = await fetch(
          `${env.SUPABASE_URL}/rest/v1/points_log?tweet_id=eq.${tweet.id}&select=id`,
          { headers: { 'apikey': env.SUPABASE_ANON, 'Authorization': `Bearer ${env.SUPABASE_ANON}` } }
        );
        const dups = await dupCheck.json();
        if (Array.isArray(dups) && dups.length > 0) continue;

        // Only log if author is a registered member
        const memberRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/members?x_handle=eq.${encodeURIComponent(xHandle)}&select=wallet_address,x_handle,points`,
          { headers: { 'apikey': env.SUPABASE_ANON, 'Authorization': `Bearer ${env.SUPABASE_ANON}` } }
        );
        const members = await memberRes.json();
        if (!Array.isArray(members) || members.length === 0) continue;
        const member = members[0];

        // Classify tweet type
        const tweetText = tweet.text || '';
        let type = 'x_post';
        if (tweetText.startsWith('RT ') || tweetText.includes('RT @')) type = 'x_engagement';
        else if (tweetText.startsWith('@')) type = 'x_reply';
        else if (tweetText.includes('RT @') || tweetText.includes('"@')) type = 'x_quote';
        const pts = type === 'x_post' ? 50 : type === 'x_reply' ? 25 : type === 'x_quote' ? 35 : 10;

        // Insert log entry
        await fetch(`${env.SUPABASE_URL}/rest/v1/points_log`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': env.SUPABASE_ANON,
            'Authorization': `Bearer ${env.SUPABASE_ANON}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            wallet_address: member.wallet_address,
            x_handle: xHandle,
            type,
            points: pts,
            reason: 'Auto-detected tweet',
            tweet_text: tweetText,
            tweet_url: `https://x.com/${user.username}/status/${tweet.id}`,
            tweet_id: tweet.id,
          }),
        });

        // Update member points total
        await fetch(`${env.SUPABASE_URL}/rest/v1/members?wallet_address=eq.${member.wallet_address}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': env.SUPABASE_ANON,
            'Authorization': `Bearer ${env.SUPABASE_ANON}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ points: (member.points || 0) + pts }),
        });

        logged++;
      }

      return new Response(JSON.stringify({ scanned: tweets.length, logged }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
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
