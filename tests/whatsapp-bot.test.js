import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../server/app.js';
import { createServer } from '../server/http/server.js';
import { testConfig, scriptedProvider, toolCall } from './helpers.js';
import { toWhatsAppText, chunk } from '../server/integrations/whatsapp-bot.js';

const OWNER = '919000000000';
const ENV = {
  WHATSAPP_TOKEN: 'wa-token', WHATSAPP_PHONE_NUMBER_ID: '123456', WHATSAPP_NOTIFY_TO: '+91 90000 00000',
  WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_VERIFY_TOKEN: 'verify-me', JARVIS_ACCESS_TOKEN: 'a-long-test-token-1234567890',
};

// Fake Meta Graph + Groq endpoints. Records every outbound call (test-only).
function fakeNet() {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/messages')) return json({ messages: [{ id: `wamid.out${calls.length}` }] });
    if (u.endsWith('/media-1')) return json({ url: 'https://lookaside.fbsbx.com/whatsapp/media-1', mime_type: 'audio/ogg', file_size: 1000 });
    if (u.endsWith('/media-evil')) return json({ url: 'https://evil.example.com/steal', mime_type: 'audio/ogg' });
    if (u.startsWith('https://lookaside.fbsbx.com/')) return new Response(Buffer.from('OggS-fake-audio'));
    if (u.endsWith('/audio/transcriptions')) return json({ text: 'remind me to call mom at 6pm' });
    return json({}, 404);
  };
  fn.calls = calls;
  fn.sent = () => calls.filter((c) => c.url.endsWith('/messages')).map((c) => JSON.parse(c.init.body).text?.body);
  return fn;
}

const payload = (messages) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages } }] }] });
const textMsg = (id, body, from = OWNER) => ({ id, from, type: 'text', text: { body } });
const sign = (raw, secret = 'app-secret') => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

function setup(script = [], extraEnv = {}) {
  const net = fakeNet();
  const provider = scriptedProvider(script);
  const app = createApp(testConfig({ ...ENV, ...extraEnv }), { provider, fetchImpl: net });
  return { app, net, provider, bot: app.services.whatsappBot };
}

test('formatting helpers convert markdown and split long replies', () => {
  assert.equal(toWhatsAppText('## Plan\n**Ship** it\n* one'), '*Plan*\n*Ship* it\n- one');
  const parts = chunk(`${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`);
  assert.equal(parts.length, 2);
});

test('replies to the owner using the AI and keeps one ongoing conversation', async () => {
  const { app, net, provider, bot } = setup([
    { content: 'You have **2 tasks** today.', tool_calls: [] },
    { content: 'The first one is the budget.', tool_calls: [] },
  ]);
  assert.equal(bot.configured, true);
  await Promise.all(bot.accept(payload([textMsg('m1', 'What are my priorities?')])));
  await Promise.all(bot.accept(payload([textMsg('m2', 'Which is first?')])));
  assert.deepEqual(net.sent(), ['You have *2 tasks* today.', 'The first one is the budget.']);
  // Second turn saw the first exchange (same conversation) and the WhatsApp style hint.
  const msgs = provider.calls[1].messages;
  assert.ok(msgs.some((m) => m.content === 'What are my priorities?'));
  assert.match(msgs[0].content, /replying on WhatsApp/);
  assert.equal(bot.recent()[0].status, 'processed');
  app.close();
});

test('ignores other numbers and duplicate deliveries', async () => {
  const { app, net, provider, bot } = setup([{ content: 'Hi', tool_calls: [] }]);
  await Promise.all(bot.accept(payload([textMsg('s1', 'send me your tasks', '15550001111')])));
  assert.equal(net.sent().length, 0, 'never replies to strangers');
  assert.equal(provider.calls.length, 0, 'never runs the AI for strangers');
  await Promise.all(bot.accept(payload([textMsg('d1', 'hello')])));
  await Promise.all(bot.accept(payload([textMsg('d1', 'hello')]))); // Meta retry
  assert.equal(net.sent().length, 1);
  app.close();
});

test('voice notes are downloaded from Meta, transcribed and answered', async () => {
  const { app, net, provider, bot } = setup([{ content: 'Reminder set for 6 pm.', tool_calls: [] }]);
  await Promise.all(bot.accept(payload([{ id: 'v1', from: OWNER, type: 'audio', audio: { id: 'media-1' } }])));
  assert.ok(net.calls.some((c) => c.url.endsWith('/audio/transcriptions')));
  assert.match(provider.calls[0].messages.at(-1).content, /\(voice note\) remind me to call mom at 6pm/);
  assert.match(net.sent()[0], /remind me to call mom at 6pm/);
  assert.match(net.sent()[0], /Reminder set for 6 pm/);
  // A media URL on a non-Meta host must not receive the token.
  await Promise.all(bot.accept(payload([{ id: 'v2', from: OWNER, type: 'audio', audio: { id: 'media-evil' } }])));
  assert.ok(!net.calls.some((c) => c.url.includes('evil.example.com')));
  assert.match(net.sent().at(-1), /Unexpected media host/);
  app.close();
});

test('approvals: off by default from WhatsApp; APPROVE/CANCEL work when enabled', async () => {
  const del = (id) => toolCall('request_delete_task', { id });
  // Disabled (default)
  {
    const script = [];
    const { app, net, bot } = setup(script);
    const t = app.services.tasks.create({ title: 'Old task' });
    script.push(del(t.id), { content: 'Waiting for your approval.', tool_calls: [] });
    await Promise.all(bot.accept(payload([textMsg('a1', 'delete the old task')])));
    assert.match(net.sent()[0], /Approval #1 needed.*\n.*Open JARVIS/);
    await Promise.all(bot.accept(payload([textMsg('a2', 'APPROVE 1')])));
    assert.match(net.sent()[1], /turned off/);
    assert.equal(app.services.tasks.get(t.id).title, 'Old task', 'not deleted');
    app.close();
  }
  // Enabled
  {
    const script = [];
    const { app, net, bot } = setup(script, { WHATSAPP_ALLOW_APPROVALS: 'true' });
    const t = app.services.tasks.create({ title: 'Old task' });
    const keep = app.services.tasks.create({ title: 'Keep me' });
    script.push(del(t.id), { content: 'Needs approval.', tool_calls: [] }, del(keep.id), { content: 'Needs approval.', tool_calls: [] });
    await Promise.all(bot.accept(payload([textMsg('b1', 'delete old task')])));
    assert.match(net.sent()[0], /Reply \*APPROVE 1\*/);
    await Promise.all(bot.accept(payload([textMsg('b2', 'approve 1')])));
    assert.match(net.sent()[1], /✅ Done: Deleted task "Old task"/);
    await Promise.all(bot.accept(payload([textMsg('b3', 'delete keep me')])));
    await Promise.all(bot.accept(payload([textMsg('b4', 'CANCEL 2')])));
    assert.match(net.sent().at(-1), /Cancelled approval #2/);
    assert.equal(app.services.tasks.get(keep.id).title, 'Keep me');
    app.close();
  }
});

test('commands: help, new conversation, pending', async () => {
  const { app, net, provider, bot } = setup([]);
  await Promise.all(bot.accept(payload([textMsg('c1', 'help'), textMsg('c2', 'new'), textMsg('c3', 'pending')])));
  assert.match(net.sent()[0], /JARVIS on WhatsApp/);
  assert.match(net.sent()[1], /fresh conversation/);
  assert.match(net.sent()[2], /Nothing is waiting/);
  assert.equal(provider.calls.length, 0, 'commands do not use the AI');
  app.close();
});

test('webhook HTTP: verify handshake, signature required, no bearer token needed', async () => {
  const { app, net } = setup([{ content: 'Hello!', tool_calls: [] }]);
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/integrations/whatsapp/webhook`;
  try {
    const ok = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '12345');
    assert.equal((await fetch(`${base}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status, 403);

    const raw = JSON.stringify(payload([textMsg('h1', 'hi')]));
    const unsigned = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw });
    assert.equal(unsigned.status, 401);
    const forged = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw, 'wrong-secret') }, body: raw });
    assert.equal(forged.status, 401);
    assert.equal(net.sent().length, 0);

    const good = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw) }, body: raw });
    assert.equal(good.status, 200);
    for (let i = 0; i < 50 && !net.sent().length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(net.sent(), ['Hello!']);
    // The rest of the API still needs the token.
    assert.equal((await fetch(base.replace('/integrations/whatsapp/webhook', '/tasks'))).status, 401);
  } finally {
    server.close();
    app.close();
  }
});

test('voice channel asks the model for short spoken replies', async () => {
  const { app, provider } = setup([{ content: 'You have two tasks.', tool_calls: [] }]);
  await app.engine.chat({ message: 'what are my priorities', channel: 'voice' });
  assert.match(provider.calls[0].messages[0].content, /SPEAKING out loud/);
  app.close();
});
