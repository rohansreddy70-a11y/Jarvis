// HTTP server: security headers, token auth, JSON API and static frontend.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApi } from './api.js';
import { readJson, HttpError } from './router.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
};

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function createServer(app) {
  const api = createApi(app);
  const publicDir = path.join(app.config.root, 'public');
  const { accessToken } = app.config;

  const send = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    res.end(JSON.stringify(data));
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      try {
        if (accessToken && pathname !== '/api/health') {
          const header = req.headers.authorization || '';
          const token = header.startsWith('Bearer ') ? header.slice(7) : '';
          if (!token || !safeEqual(token, accessToken)) throw new HttpError(401, 'Access token required.');
        }
        // Simple CSRF defence for state-changing requests: require same-origin JSON.
        if (req.method !== 'GET' && req.headers.origin) {
          let originHost = null;
          try { originHost = new URL(req.headers.origin).host; } catch { /* "null" or malformed */ }
          if (originHost !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked.');
        }
        const route = api.match(req.method, pathname);
        if (!route) throw new HttpError(404, 'Not found.');
        if (route.methodNotAllowed) throw new HttpError(405, 'Method not allowed.');
        const body = await readJson(req);
        const result = await route.handler({ params: route.params, query: url.searchParams, body });
        return send(res, 200, result ?? { ok: true });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500 && status !== 502 && status !== 503) {
          app.services.activity.log('system.error', `API error on ${req.method} ${pathname}: ${err.message}`);
          console.error(`[jarvis] ${req.method} ${pathname}:`, err.message);
          return send(res, 500, { error: 'Internal error. See server logs.' });
        }
        return send(res, status, { error: err.message });
      }
    }

    // Static files (path traversal safe).
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
    let file = path.normalize(path.join(publicDir, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(publicDir + path.sep)) return send(res, 403, { error: 'Forbidden.' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(publicDir, 'index.html');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
