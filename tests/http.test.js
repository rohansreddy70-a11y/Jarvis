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

test('Google OAuth callback bypasses token auth but rejects forged state with a redirect', async () => {
  await withServer({ JARVIS_ACCESS_TOKEN: 'a-long-test-token-1234567890', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' }, async (base) => {
    const res = await fetch(`${base}/api/integrations/google/callback?code=abc&state=forged`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^\/#\/email\?error=/);
    assert.equal((await fetch(`${base}/api/email/messages`)).status, 401, 'other routes still need the token');
  });
});

test('body-less action POSTs work (approval confirm, reminder cancel)', async () => {
  await withServer({}, async (base, app) => {
    const t = app.services.tasks.create({ title: 'Temp' });
    const a = app.services.approvals.request({ actionType: 'task.delete', summary: 'Delete', payload: { id: t.id } });
    const res = await fetch(`${base}/api/approvals/${a.id}/confirm`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'executed');
    const r = app.services.reminders.create({ message: 'x', remind_at: new Date(Date.now() + 3600e3).toISOString() });
    assert.equal((await fetch(`${base}/api/reminders/${r.id}/cancel`, { method: 'POST' })).status, 200);
    const bad = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'title=x' });
    assert.equal(bad.status, 415, 'non-JSON bodies are still rejected');
  });
});
