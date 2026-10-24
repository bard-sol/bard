import { handleRequest } from './server/api.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const response = await handleRequest(request, env);
      if (response) return response;
    }
    return env.ASSETS.fetch(request);
  },
};
