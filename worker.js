import { handleApi } from './season0/worker/handlers.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env || {});
    }
    const night = url.pathname.match(/^\/night\/(\d+)\/?$/);
    if (night) {
      url.pathname = '/night.html';
      url.searchParams.set('chapter', night[1]);
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  }
};
