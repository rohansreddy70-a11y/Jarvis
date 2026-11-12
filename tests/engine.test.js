import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, toolCall } from './helpers.js';
import { createApp } from '../server/app.js';
import { buildConfig } from '../server/config.js';

test('engine runs tools and returns the final reply', async () => {
  const { app, provider } = makeApp([
    toolCall('create_task', { title: 'Prepare board deck', priority: 'top', reason: 'Board meets Friday' }),
    { content: 'Added "Prepare board deck" to your Top 3.', tool_calls: [] },
  ]);
  const r = await app.engine.chat({ message: 'Add a top task to prepare the board deck' });
  assert.equal(r.reply, 'Added "Prepare board deck" to your Top 3.');
  assert.deepEqual(r.actions.map((a) => [a.tool, a.ok]), [['create_task', true]]);
  assert.equal(app.services.tasks.list()[0].title, 'Prepare board deck');
  // Second model call must include the tool result.
  const second = provider.calls[1].messages;
  assert.equal(second.at(-1).role, 'tool');
  assert.match(second.at(-1).content, /Prepare board deck/);
  assert.match(second[0].content, /You are JARVIS/);
  app.close();
});

test('assistant cannot delete directly — it only creates an approval', async () => {
  const script = [];
  const { app } = makeApp(script);
  const t = app.services.tasks.create({ title: 'Old task' });
  script.push(toolCall('request_delete_task', { id: t.id }), { content: 'Deletion is awaiting your approval.', tool_calls: [] });
  const r = await app.engine.chat({ message: 'delete the old task' });
  assert.ok(r.actions[0].approvalId, 'approval id surfaced to UI');
  assert.equal(app.services.tasks.get(t.id).title, 'Old task', 'task still exists');
  assert.equal(app.services.approvals.pendingCount(), 1);
  app.close();
});

test('tool errors are reported back to the model, not hidden', async () => {
  const { app, provider } = makeApp([
    toolCall('update_task', { id: 999, status: 'done' }),
    { content: 'I could not find that task.', tool_calls: [] },
  ]);
  const r = await app.engine.chat({ message: 'mark task 999 done' });
  assert.equal(r.actions[0].ok, false);
  assert.match(provider.calls[1].messages.at(-1).content, /not found/);
  app.close();
});

test('conversation context persists between turns', async () => {
  const { app, provider } = makeApp([
    { content: 'Noted.', tool_calls: [] },
    { content: 'You told me about Atlas.', tool_calls: [] },
  ]);
  const first = await app.engine.chat({ message: 'I am working on Atlas' });
  await app.engine.chat({ conversationId: first.conversationId, message: 'What am I working on?' });
  const msgs = provider.calls[1].messages.map((m) => m.content);
  assert.ok(msgs.includes('I am working on Atlas'));
  assert.ok(msgs.includes('Noted.'));
  app.close();
});

test('missing AI configuration gives a clear error', async () => {
  const app = createApp(buildConfig({ JARVIS_DB_PATH: ':memory:', AI_PROVIDER: 'groq' }));
  await assert.rejects(app.engine.chat({ message: 'hi' }), /GROQ_API_KEY/);
  app.close();
});
