import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { testConfig } from './helpers.js';
import { templateSafe } from '../server/integrations/whatsapp.js';

// Records outgoing HTTP calls and answers from a route table. Test-only.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, reply] of routes) {
      if (String(url).includes(match)) {
        const { status = 200, body = {} } = typeof reply === 'function' ? reply(String(url), init) : reply;
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('{}', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

const WA = { WHATSAPP_TOKEN: 'wa-token', WHATSAPP_PHONE_NUMBER_ID: '123456', WHATSAPP_NOTIFY_TO: '+91 90000 00000' };
const GOOGLE = { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'csecret' };

test('schedule for tomorrow uses the configured time zone', () => {
  const app = createApp(testConfig({ JARVIS_TIMEZONE: 'Asia/Kolkata' }), { provider: null });
  const { events, schedule } = app.services;
  const tomorrow = schedule.resolve('tomorrow');
  events.create({ title: 'Dentist', starts_at: new Date(tomorrow.start.getTime() + 16 * 3600e3).toISOString() });
  events.create({ title: 'Not tomorrow', starts_at: new Date(tomorrow.end.getTime() + 3600e3).toISOString() });
  const sch = schedule.forDay('tomorrow');
  assert.deepEqual(sch.events.map((e) => e.title), ['Dentist']);
  const text = schedule.toText(sch, 'Tomorrow');
  assert.match(text, /Dentist/);
  assert.match(text, /4:00\s?pm/i, 'rendered in IST');
  app.close();
});

test('empty day prompts the user to plan', () => {
  const app = createApp(testConfig(), { provider: null });
  const { schedule } = app.services;
  assert.match(schedule.toText(schedule.forDay('tomorrow')), /Nothing is scheduled yet/);
  app.close();
});

test('bedtime automation: enabled by default, runs once per day, delivers to WhatsApp', async () => {
  const f = fakeFetch([['graph.facebook.com', { body: { messages: [{ id: 'wamid.1' }] } }]]);
  const app = createApp(testConfig({ ...WA, JARVIS_TIMEZONE: 'Asia/Kolkata', JARVIS_BEDTIME_BRIEFING: '21:30' }), { provider: null, fetchImpl: f });
  const auto = app.services.automations;
  assert.equal(auto.get('bedtime_schedule').enabled, true);
  assert.equal(auto.get('morning_schedule').enabled, false, 'other automations are off until the user enables them');

  const bedtime = (runs) => runs.filter((r) => r.automation_id === 'bedtime_schedule');
  const before = new Date('2026-11-12T15:59:00Z'); // 21:29 IST
  assert.equal(bedtime(await auto.tick(before)).length, 0);
  const at = new Date('2026-11-12T16:00:00Z'); // 21:30 IST
  const [run] = bedtime(await auto.tick(at));
  assert.equal(run.status, 'success');
  assert.equal((await auto.tick(new Date('2026-11-12T16:05:00Z'))).length, 0, 'no duplicate runs the same day');

  assert.equal(f.calls.length, 1, 'only bedtime goes to WhatsApp by default');
  const sent = JSON.parse(f.calls[0].init.body);
  assert.equal(sent.to, '919000000000');
  assert.equal(sent.type, 'text');
  assert.match(sent.text.body, /Tomorrow's schedule/);
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer wa-token');
  app.close();
});

test('WhatsApp failure is recorded as partial and notifies the user', async () => {
  const f = fakeFetch([['graph.facebook.com', { status: 400, body: { error: { message: 'Re-engagement message', code: 131047 } } }]]);
  const app = createApp(testConfig(WA), { provider: null, fetchImpl: f });
  const run = await app.services.automations.runNow('bedtime_schedule');
  assert.equal(run.status, 'partial');
  assert.match(run.error, /24-hour window/);
  assert.ok(app.services.notifications.list().some((n) => /delivery problem/.test(n.title)));
  app.close();
});

test('WhatsApp template mode sends a single-line template variable', async () => {
  const f = fakeFetch([['graph.facebook.com', { body: { messages: [{ id: 'wamid.2' }] } }]]);
  const app = createApp(testConfig({ ...WA, WHATSAPP_TEMPLATE_NAME: 'jarvis_briefing' }), { provider: null, fetchImpl: f });
  await app.services.integrations.whatsapp.notifyOwner('Line one\nLine two');
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.type, 'template');
  assert.equal(body.template.components[0].parameters[0].text, 'Line one | Line two');
  assert.ok(!/\n/.test(templateSafe('a\n\n\tb    c')));
  app.close();
});

test('automation settings are validated', () => {
  const app = createApp(testConfig(), { provider: null });
  const a = app.services.automations;
  assert.throws(() => a.update('bedtime_schedule', { run_at: '25:00' }), /HH:MM/);
  assert.throws(() => a.update('bedtime_schedule', { channels: ['sms'] }), /channels/);
  assert.equal(a.update('bedtime_schedule', { run_at: '22:15', channels: ['in_app'] }).run_at, '22:15');
  app.close();
});

test('Gmail: OAuth state is one-time, tokens stay server-side, inbox listing works', async () => {
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', { body: { access_token: 'at', refresh_token: 'rt-secret', expires_in: 3600, scope: 'gmail' } }],
    ['/profile', { body: { emailAddress: 'owner@example.com' } }],
    ['/messages?', { body: { messages: [{ id: 'm1' }] } }],
    ['/messages/m1', { body: { id: 'm1', threadId: 't1', snippet: 'Can you review &amp; reply?', labelIds: ['UNREAD', 'IMPORTANT'], internalDate: '1700000000000', payload: { headers: [{ name: 'From', value: 'Boss <boss@example.com>' }, { name: 'Subject', value: 'Budget' }] } } }],
  ]);
  const app = createApp(testConfig(GOOGLE), { provider: null, fetchImpl: f });
  const g = app.services.integrations.google;
  assert.equal(app.services.integrations.status().find((i) => i.id === 'email').status, 'needs_authorization');

  const url = new URL(g.authUrl());
  assert.match(url.searchParams.get('scope'), /gmail\.readonly/);
  const state = url.searchParams.get('state');
  await assert.rejects(g.handleCallback({ code: 'c', state: 'forged' }), /expired or invalid/);
  const acct = await g.handleCallback({ code: 'c', state });
  assert.equal(acct.email, 'owner@example.com');
  await assert.rejects(g.handleCallback({ code: 'c', state }), /expired or invalid/, 'state cannot be reused');

  const status = app.services.integrations.status().find((i) => i.id === 'email');
  assert.equal(status.connected, true);
  assert.ok(!JSON.stringify(status).includes('rt-secret'));
  const [m] = await g.listMessages();
  assert.equal(m.subject, 'Budget');
  assert.equal(m.unread, true);
  assert.equal(m.snippet, 'Can you review & reply?');
  app.close();
});

test('approved email send goes through Gmail; header injection is refused', async () => {
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', { body: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } }],
    ['/profile', { body: { emailAddress: 'o@example.com' } }],
    ['/messages/send', { body: { id: 'sent-1' } }],
  ]);
  const app = createApp(testConfig(GOOGLE), { provider: null, fetchImpl: f });
  const { google } = app.services.integrations;
  const state = new URL(google.authUrl()).searchParams.get('state');
  await google.handleCallback({ code: 'c', state });

  const { drafts, approvals } = app.services;
  const d = drafts.create({ kind: 'email', recipient: 'sam@example.com', subject: 'Hello', body: 'Hi Sam' });
  const a = approvals.request({ actionType: 'draft.send', summary: 'Send', payload: { draft_id: d.id } });
  assert.equal(f.calls.filter((c) => c.url.includes('/send')).length, 0, 'nothing sent before approval');
  const done = await approvals.confirm(a.id);
  assert.equal(done.status, 'executed');
  assert.match(done.result, /sent-1/);
  assert.equal(drafts.get(d.id).status, 'sent');
  const raw = Buffer.from(JSON.parse(f.calls.find((c) => c.url.includes('/send')).init.body).raw, 'base64url').toString();
  assert.match(raw, /^To: sam@example.com/);

  const bad = drafts.create({ kind: 'email', recipient: 'x@example.com\r\nBcc: evil@example.com', subject: 'Hi', body: 'b' });
  const a2 = approvals.request({ actionType: 'draft.send', summary: 'Send', payload: { draft_id: bad.id } });
  const r2 = await approvals.confirm(a2.id);
  assert.equal(r2.status, 'failed');
  assert.equal(drafts.get(bad.id).status, 'draft');
  app.close();
});
