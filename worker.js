import { handleApi } from './season0/worker/handlers.js';

function redirect(url, pathname) {
  const next = new URL(url);
  next.pathname = pathname;
  return Response.redirect(next, 302);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env || {});
    }
    if (url.pathname === '/season.html') return redirect(url, '/play/');
    if (url.pathname === '/qa.html') return redirect(url, '/play/qa.html');
    if (url.pathname === '/control.html') return redirect(url, '/play/control.html');
    if (url.pathname === '/night.html') return redirect(url, '/play/night.html');
    const oldNight = url.pathname.match(/^\/night\/(\d+)\/?$/);
    if (oldNight) return redirect(url, '/play/night/' + oldNight[1]);
    const night = url.pathname.match(/^\/play\/night\/(\d+)\/?$/);
    if (night) {
      url.pathname = '/play/night.html';
      url.searchParams.set('chapter', night[1]);
      return env.ASSETS.fetch(new Request(url, request));
    }
    if (url.pathname === '/play' || url.pathname === '/play/') {
      url.pathname = '/play/index.html';
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  }
};
