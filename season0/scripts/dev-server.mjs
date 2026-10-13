#!/usr/bin/env node
/** Local Season 0 server. Static files plus the worker API. Devnet routes only. */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { handleApi } from '../worker/handlers.js';

const root = resolve(import.meta.dirname, '../..');
const port = Number(process.env.PORT || 8787);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp'
};

const env = {
  SEASON_ALLOW_DEMO: '1',
  SEASON_DEV_SKIP_TURNSTILE: '1'
};

function staticPath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, clean);
  if (!file.startsWith(root)) return null;
  return file;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const night = url.pathname.match(/^\/night\/(\d+)\/?$/);
    if (night) {
      url.pathname = '/night.html';
      url.searchParams.set('chapter', night[1]);
    }
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
      });
      const response = await handleApi(request, env);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let file = staticPath(url.pathname);
    if (!file) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
    if (url.pathname.endsWith('/')) file = join(file, 'index.html');
    const data = await readFile(file);
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.statusCode = 500;
    res.end(String(err && err.message || err));
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write('Season 0 dev server http://127.0.0.1:' + port + '/season.html\n');
});
