import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';

test('tasks: create, prioritize, complete, summary', () => {
  const { app } = makeApp();
  const { tasks } = app.services;
  const a = tasks.create({ title: 'Finish Q4 report', priority: 'top', reason: 'Board meeting Friday' });
  tasks.create({ title: 'File expenses', priority: 'routine' });
  tasks.create({ title: 'Overdue thing', priority: 'important', due_at: new Date(Date.now() - 3600e3).toISOString() });
  assert.equal(tasks.list()[0].id, a.id, 'top priority sorts first');
  tasks.update(a.id, { status: 'done' });
  const s = tasks.summary();
  assert.equal(s.open, 2);
  assert.equal(s.overdue, 1);
  assert.equal(s.doneLast24h, 1);
  assert.throws(() => tasks.create({ title: '' }), /cannot be empty|required/);
  assert.throws(() => tasks.create({ title: 'x', priority: 'urgent' }), /priority must be one of/);
  app.close();
});

test('reminders fire exactly once and create a notification', () => {
  const { app } = makeApp();
  const { reminders, notifications, db } = app.services;
  const r = reminders.create({ message: 'Call vendor', remind_at: new Date(Date.now() + 5000).toISOString() });
  assert.deepEqual(reminders.fireDue(new Date()), []);
  const later = new Date(Date.now() + 10_000);
  assert.equal(reminders.fireDue(later).length, 1);
  assert.equal(reminders.fireDue(later).length, 0, 'no duplicate firing');
  assert.equal(reminders.get(r.id).status, 'fired');
  assert.equal(notifications.unreadCount(), 1);
  assert.throws(() => reminders.create({ message: 'old', remind_at: '2001-01-01T00:00:00Z' }), /in the past/);
  db.exec('SELECT 1');
  app.close();
});

test('memory: CRUD, search, and refuses credentials', () => {
  const { app } = makeApp();
  const { memory } = app.services;
  const m = memory.create({ category: 'writing_style', content: 'Prefers short, direct emails with a clear ask.' });
  memory.create({ category: 'project', content: 'Project Atlas launches in March.' });
  assert.equal(memory.list({ query: 'atlas march' }).length, 1);
  assert.equal(memory.list({ category: 'writing_style' }).length, 1);
  memory.update(m.id, { content: 'Prefers concise emails.' });
  assert.equal(memory.get(m.id).content, 'Prefers concise emails.');
  assert.throws(() => memory.create({ category: 'other', content: 'my key is gsk_abcdefghijklmnopqrstuvwxyz123456' }), /credential/);
  assert.throws(() => memory.create({ category: 'other', content: 'password: hunter2' }), /credential/);
  memory.remove(m.id);
  assert.equal(memory.list().length, 1);
  app.close();
});

test('activity log redacts secrets', () => {
  const { app } = makeApp();
  app.services.activity.log('test', 'leaked sk-proj-abcdefghijklmnopqrstuvwxyz0123', { token: 'gsk_abcdefghijklmnopqrstuvwxyz123456' });
  const [row] = app.services.activity.list({ type: 'test' });
  assert.ok(!row.message.includes('sk-proj'));
  assert.ok(!JSON.stringify(row.meta).includes('gsk_'));
  app.close();
});

test('approvals: nothing executes until confirmed; double-confirm blocked', async () => {
  const { app } = makeApp();
  const { tasks, approvals } = app.services;
  const t = tasks.create({ title: 'Delete me' });
  const a = approvals.request({ actionType: 'task.delete', target: 'Task', summary: 'Delete task', payload: { id: t.id } });
  assert.equal(tasks.get(t.id).id, t.id, 'still exists before confirmation');
  const done = await approvals.confirm(a.id);
  assert.equal(done.status, 'executed');
  assert.throws(() => tasks.get(t.id), /not found/);
  await assert.rejects(approvals.confirm(a.id), /already/);
  app.close();
});

test('approvals: rejecting leaves data untouched', () => {
  const { app } = makeApp();
  const { tasks, approvals } = app.services;
  const t = tasks.create({ title: 'Keep me' });
  const a = approvals.request({ actionType: 'task.delete', summary: 'Delete task', payload: { id: t.id } });
  approvals.reject(a.id);
  assert.equal(tasks.get(t.id).title, 'Keep me');
  app.close();
});

test('sending a draft fails honestly when email is not connected', async () => {
  const { app } = makeApp();
  const { drafts, approvals } = app.services;
  const d = drafts.create({ kind: 'email', recipient: 'sam@example.com', subject: 'Hi', body: 'Hello' });
  const a = approvals.request({ actionType: 'draft.send', summary: 'Send email', payload: { draft_id: d.id } });
  const result = await approvals.confirm(a.id);
  assert.equal(result.status, 'failed');
  assert.match(result.result, /not connected/);
  assert.equal(drafts.get(d.id).status, 'draft', 'draft is kept');
  app.close();
});
