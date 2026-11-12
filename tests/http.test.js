import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/http/server.js';
import { makeApp } from './helpers.js';

async function withServer(overrides, fn) {
  const { app } = makeApp([], overrides);
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, app); } finally { server.close(); app.close(); }
}

test('API requires the access token when configured', async () => {
  await withServer({ JARVIS_ACCESS_TOKEN: 'a-long-test-token-1234567890' }, async (base) => {
    assert.equal((await fetch(`${base}/api/status`)).status, 401);
    const ok = await fetch(`${base}/api/status`, { headers: { Authorization: 'Bearer a-long-test-token-1234567890' } });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.ok(!JSON.stringify(body).includes('test-key'), 'no secrets in status');
  });
});

test('CRUD over HTTP, validation and security headers', async () => {
  await withServer({}, async (base) => {
    const post = (p, b) => fetch(`${base}/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const res = await post('/tasks', { title: 'Write spec', priority: 'top' });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-security-policy'));
    assert.equal((await post('/tasks', { title: '' })).status, 400);
    assert.equal((await fetch(`${base}/api/tasks/999`, { method: 'DELETE' })).status, 404);
    const cross = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{"title":"x"}' });
    assert.equal(cross.status, 403);
    const dash = await (await fetch(`${base}/api/dashboard`)).json();
    assert.equal(dash.tasks.byPriority.top, 1);
    const html = await fetch(`${base}/`);
    assert.match(await html.text(), /J\.A\.R\.V\.I\.S/);
    assert.equal((await fetch(`${base}/..%2f..%2fpackage.json`)).status !== 500, true);
  });
});
