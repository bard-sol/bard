export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/vault/bard-sign' && request.method === 'POST') {
      // Bard's second key lives in env.BARD_VAULT_SECRET (never in the browser).
      // Until that secret is set, we return waiting so the team UI can show
      // "You signed · waiting for Bard".
      if (!env.BARD_VAULT_SECRET) {
        return Response.json({ ok: false, waiting: true, reason: 'bard_signer_offline' });
      }
      return Response.json({ ok: false, waiting: true, reason: 'bard_signer_not_wired' });
    }
    return env.ASSETS.fetch(request);
  }
};
