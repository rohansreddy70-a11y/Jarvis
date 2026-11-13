import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { testConfig } from './helpers.js';

const IST = { JARVIS_TIMEZONE: 'Asia/Kolkata', JARVIS_USER_NAME: 'Rohan' };
// Friday 13 Nov 2026, 13:00 IST
const NOON = new Date('2026-11-13T07:30:00Z');
const iso = (s) => new Date(s).toISOString();

function seed(app, now = NOON) {
  const { tasks, db } = app.services;
  const doneTop = tasks.create({ title: 'Ship budget proposal', priority: 'top', project: 'Finance', reason: 'CFO review' });
  tasks.update(doneTop.id, { status: 'done' });
  const late = tasks.create({ title: 'Vendor contract review', priority: 'important', due_at: iso('2026-11-12T06:30:00Z') });
  const dueToday = tasks.create({ title: 'Send client deck', priority: 'routine', due_at: iso('2026-11-13T11:30:00Z') });
  const top = tasks.create({ title: 'Prepare board slides', priority: 'top' });
  tasks.create({ title: 'Clean up notes', priority: 'upcoming' });
  // Pin completion time to "this morning" so the report window is deterministic.
  db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?').run(iso('2026-11-13T05:00:00Z'), doneTop.id);
  return { doneTop, late, dueToday, top, now };
}

test('midday check-in: sections, suggested order by urgency, nothing removed', async () => {
  const app = createApp(testConfig(IST), { provider: null });
  const { late, dueToday, top } = seed(app);
  const before = app.services.tasks.list().map((x) => [x.id, x.priority, x.status]);
  const r = await app.services.reports.generate('midday', { now: NOON });
  for (const h of ['Completed so far', 'Delayed (overdue)', 'Deadlines in the next 48 hours', 'Important new messages', 'Potential problems', 'Suggested order']) {
    assert.match(r.content, new RegExp(h.replace(/[()]/g, '\\$&')));
  }
  assert.match(r.content, /Ship budget proposal/);
  assert.match(r.content, /Gmail is not connected/);
  assert.deepEqual(r.data.suggestedOrder.slice(0, 3).map((x) => x.id), [late.id, dueToday.id, top.id], 'overdue, then due today, then top priority');
  assert.deepEqual(app.services.tasks.list().map((x) => [x.id, x.priority, x.status]), before, 'tasks are unchanged');
  assert.equal(r.period_key, '2026-11-13');
  app.close();
});

test('end-of-day: all 8 sections and a manager update saved as a draft (refreshed, not duplicated)', async () => {
  const app = createApp(testConfig({ ...IST, REPORT_MANAGER_EMAIL: 'manager@example.com' }), { provider: null });
  seed(app);
  const evening = new Date('2026-11-13T13:00:00Z'); // 18:30 IST
  const r = await app.services.reports.generate('end_of_day', { now: evening });
  for (let i = 1; i <= 8; i++) assert.match(r.content, new RegExp(`\\n${i}\\. `));
  assert.match(r.content, /Vendor contract review.*still overdue/);
  assert.match(r.content, /Send client deck.*missed today/);
  const d = app.services.drafts.get(r.draft_id);
  assert.equal(d.kind, 'status_update');
  assert.equal(d.status, 'draft', 'never sent automatically');
  assert.equal(d.recipient, 'manager@example.com');
  assert.match(d.body, /Completed today:\n• Ship budget proposal/);
  assert.match(d.body, /Rohan$/);
  const again = await app.services.reports.generate('end_of_day', { now: evening });
  assert.equal(again.draft_id, r.draft_id, 'same-day regeneration updates the existing draft');
  assert.equal(app.services.drafts.list().length, 1);
  app.close();
});

test('weekly review: projects, blockers, decisions and organization suggestions', async () => {
  const app = createApp(testConfig(IST), { provider: null });
  seed(app);
  app.services.memory.create({ category: 'decision', content: 'Decision: move launch to March' });
  const friday = new Date('2026-11-13T12:00:00Z');
  const r = await app.services.reports.generate('weekly', { now: friday });
  assert.equal(r.period_key, '2026-11-09', 'week starts Monday');
  assert.match(r.content, /Finance: 1 task completed/);
  assert.match(r.content, /Vendor contract review.*\(overdue\)/);
  assert.match(r.content, /move launch to March/);
  assert.match(r.content, /Organization suggestions/);
  assert.match(r.content, /has not deleted, moved or shared anything/);
  app.close();
});

test('report automations: weekday-aware, in-app by default, linked to the stored report', async () => {
  const app = createApp(testConfig(IST), { provider: null });
  const auto = app.services.automations;
  const weekly = auto.get('weekly_review');
  assert.deepEqual(weekly.days, [5]);
  assert.deepEqual(weekly.channels, ['in_app']);
  // Thursday 17:30 IST — weekly must not run.
  const thu = await auto.tick(new Date('2026-11-12T12:00:00Z'));
  assert.ok(!thu.some((r) => r.automation_id === 'weekly_review'));
  // Friday 17:30 IST — weekly runs once.
  const fri = await auto.tick(new Date('2026-11-13T12:00:00Z'));
  const run = fri.find((r) => r.automation_id === 'weekly_review');
  assert.equal(run.status, 'success');
  const note = app.services.notifications.list().find((n) => n.title === 'Weekly review');
  assert.match(note.link, /^#\/reports\/\d+$/);
  assert.equal(app.services.reports.list({ type: 'weekly' }).length, 1);
  assert.throws(() => auto.update('weekly_review', { days: [8] }), /weekday/);
  // Sunday 13:00 IST — weekday-only midday check-in must not run.
  const sun = await auto.tick(new Date('2026-11-15T07:30:00Z'));
  assert.ok(!sun.some((r) => r.automation_id === 'midday_checkin'));
  app.close();
});

test('assistant can generate a report through its tool', async () => {
  const app = createApp(testConfig(IST), { provider: null });
  const out = await app.toolbox.run('generate_report', { type: 'end_of_day' });
  assert.equal(out.ok, true);
  assert.match(out.result.text, /End-of-day wrap-up/);
  assert.match(out.result.note, /NOT sent/);
  app.close();
});
