import { handleRequest, rewriteCampaignRequest } from './server/api.js';

async function fetchAsset(request, env) {
  const assetRequest = rewriteCampaignRequest(request);
  let response = await env.ASSETS.fetch(assetRequest);
  if (assetRequest === request) return response;
  for (let hop = 0; hop < 3 && response.status >= 300 && response.status < 400; hop += 1) {
    const location = response.headers.get('location');
    if (!location) break;
    const next = new URL(location, request.url);
    response = await env.ASSETS.fetch(new Request(next.toString(), { method: 'GET' }));
  }
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const response = await handleRequest(request, env);
      if (response) return response;
    }
    return fetchAsset(request, env);
  },
};
