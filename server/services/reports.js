// Productivity reports: midday check-in, end-of-day wrap-up, weekly review.
// Built deterministically from JARVIS's own data (plus Gmail when connected),
// so they work without the AI provider and never invent anything.
// Reports never change or remove tasks — they only suggest.
import { nowIso, dayBounds, weekStart, formatTime, formatDay, ValidationError } from '../lib/time.js';
import { id as vid, NotFoundError } from './validate.js';

export const REPORT_TYPES = ['midday', 'end_of_day', 'weekly'];
const TITLES = { midday: 'Midday check-in', end_of_day: 'End-of-day wrap-up', weekly: 'Weekly review' };
const OPEN = "status IN ('pending','in_progress')";
const PRIO_RANK = { top: 0, important: 1, routine: 2, upcoming: 3 };

export function createReportService({ db, tasks, events, drafts, memory, activity, schedule, integrations }, config) {
  const tz = () => config.timezone;
  const t = (iso) => formatTime(new Date(iso), tz());
  const shortDay = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: tz(), weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
  const q = (sql, ...a) => db.prepare(sql).all(...a);

  const completedBetween = (from, to) => q(`SELECT * FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ? ORDER BY completed_at`, from.toISOString(), to.toISOString());
  const openTasks = () => q(`SELECT * FROM tasks WHERE ${OPEN}`);
  const overdue = (now) => q(`SELECT * FROM tasks WHERE ${OPEN} AND due_at < ? ORDER BY due_at`, now.toISOString());
  const dueBetween = (from, to) => q(`SELECT * FROM tasks WHERE ${OPEN} AND due_at >= ? AND due_at < ? ORDER BY due_at`, from.toISOString(), to.toISOString());
  const missedBetween = (from, to) => q(`SELECT * FROM tasks WHERE ${OPEN} AND due_at >= ? AND due_at < ? ORDER BY due_at`, from.toISOString(), to.toISOString());

  // Urgency/importance ranking used to reorganize remaining work (a suggestion only).
  function rank(list, now, dayEnd) {
    const soon = now.getTime() + 2 * 86400e3;
    const scored = list.map((task) => {
      const due = task.due_at ? Date.parse(task.due_at) : null;
      let score; let why;
      if (due && due < now.getTime()) { score = 0; why = `overdue since ${shortDay(task.due_at)}`; }
      else if (due && due < dayEnd.getTime()) { score = 1; why = `due today ${t(task.due_at)}`; }
      else if (task.priority === 'top') { score = 2; why = 'top priority'; }
      else if (due && due < soon) { score = 3; why = `due ${shortDay(task.due_at)}`; }
      else { score = 4 + PRIO_RANK[task.priority]; why = task.priority; }
      if (task.status === 'in_progress') why += ', in progress';
      return { task, score, why };
    });
    return scored.sort((a, b) => a.score - b.score || (a.task.due_at || '9').localeCompare(b.task.due_at || '9') || a.task.id - b.task.id);
  }

  // Calendar changes made today that affect today or later (from the activity log).
  function scheduleChanges(from) {
    return q(`SELECT * FROM activity_log WHERE type IN ('event.created','event.updated','event.deleted') AND created_at >= ? ORDER BY id`, from.toISOString())
      .map((r) => r.message);
  }

  async function importantMail(query) {
    const g = integrations.google;
    if (!g.connected) return { connected: false, messages: [] };
    try {
      return { connected: true, messages: await g.listMessages({ query, max: 10 }) };
    } catch (err) {
      return { connected: true, messages: [], error: err.message };
    }
  }
  const mailLines = (mail) => {
    if (!mail.connected) return ['Gmail is not connected — no inbox review.'];
    if (mail.error) return [`Could not check Gmail: ${mail.error}`];
    if (!mail.messages.length) return ['No new important messages.'];
    return mail.messages.map((m) => `${m.from.replace(/<.*>/, '').trim() || m.from} — ${m.subject}${m.unread ? ' (unread)' : ''}`);
  };

  const bullets = (items, empty = 'None.') => (items.length ? items.map((x) => (/^\d+\. /.test(x) ? x : `• ${x}`)) : [`• ${empty}`]);
  const section = (title, items, empty) => ['', `${title}:`, ...bullets(items, empty)];
  const taskLine = (x) => `${x.title}${x.project ? ` [${x.project}]` : ''}${x.due_at ? ` — due ${shortDay(x.due_at)} ${t(x.due_at)}` : ''}`;

  // ───────────── Midday ─────────────
  async function midday(now) {
    const today = dayBounds(now, tz(), 0);
    const done = completedBetween(today.start, now);
    const open = openTasks();
    const late = overdue(now);
    const next48 = dueBetween(now, new Date(now.getTime() + 48 * 3600e3));
    const ranked = rank(open, now, today.end);
    const remainingEvents = events.between(now, today.end);
    const mail = await importantMail('is:important is:unread newer_than:1d');
    const changes = scheduleChanges(today.start);

    const problems = [];
    if (late.length) problems.push(`${late.length} task${late.length > 1 ? 's are' : ' is'} overdue.`);
    const dueRestOfDay = open.filter((x) => x.due_at && Date.parse(x.due_at) >= now.getTime() && Date.parse(x.due_at) < today.end.getTime());
    if (dueRestOfDay.length > 3) problems.push(`${dueRestOfDay.length} tasks are due before the end of today — consider moving some.`);
    const topOpen = open.filter((x) => x.priority === 'top');
    if (topOpen.length > 3) problems.push(`${topOpen.length} tasks are marked Top 3 — pick the three that matter most.`);
    if (!done.length) problems.push('Nothing marked done yet today.');

    const lines = [
      `☀️ Midday check-in — ${formatDay(now, tz())}, ${t(now.toISOString())}`,
      `Done today: ${done.length} · Pending: ${open.length} · Overdue: ${late.length}`,
      ...section('Completed so far', done.map((x) => x.title), 'Nothing marked done yet.'),
      ...section('Delayed (overdue)', late.map(taskLine)),
      ...section('Deadlines in the next 48 hours', next48.map(taskLine)),
      ...section('Rest of today\'s calendar', remainingEvents.map((e) => `${e.all_day ? 'All day' : t(e.starts_at)} ${e.title}${!e.all_day && Date.parse(e.starts_at) < now.getTime() ? ' (in progress)' : ''}`), 'No more events today.'),
      ...section('Schedule changes today', changes, 'No changes.'),
      ...section('Important new messages', mailLines(mail)),
      ...section('Potential problems', problems, 'None spotted.'),
      ...section('Suggested order for the rest of the day', ranked.slice(0, 8).map((r, i) => `${i + 1}. ${r.task.title} (${r.why})`), 'No open tasks.'),
    ];
    if (ranked.length > 8) lines.push(`…and ${ranked.length - 8} more. Nothing has been changed or removed — this order is a suggestion.`);
    else if (ranked.length) lines.push('', 'Nothing has been changed or removed — this order is a suggestion.');
    return {
      text: lines.join('\n'),
      data: { done: done.length, pending: open.length, overdue: late.length, suggestedOrder: ranked.map((r) => ({ id: r.task.id, why: r.why })) },
      summary: `${done.length} done · ${open.length} pending · ${late.length} overdue`,
    };
  }

  // ───────────── End of day ─────────────
  async function endOfDay(now) {
    const today = dayBounds(now, tz(), 0);
    const tomorrow = dayBounds(now, tz(), 1);
    const done = completedBetween(today.start, today.end);
    const achievements = done.filter((x) => x.priority === 'top' || x.priority === 'important');
    const open = openTasks();
    const missed = missedBetween(today.start, now);
    const olderOverdue = overdue(today.start);
    const carry = rank(open, now, today.end).slice(0, 10);
    const tmr = schedule.forDay('tomorrow', now);
    const tmrPriorities = rank(open, tomorrow.start, tomorrow.end).slice(0, 3);
    const mail = await importantMail('is:important newer_than:1d');
    const created = q('SELECT COUNT(*) AS c FROM tasks WHERE created_at >= ? AND created_at < ?', today.start.toISOString(), today.end.toISOString())[0].c;

    const lines = [
      `🌆 End-of-day wrap-up — ${formatDay(now, tz())}`,
      `Completed: ${done.length} · Added: ${created} · Still open: ${open.length}`,
      ...section('1. Work completed', done.map(taskLine), 'Nothing marked done today.'),
      ...section('2. Major achievements', achievements.map((x) => `${x.title}${x.reason ? ' — ' + x.reason : ''}`), 'No top or important tasks finished today.'),
      ...section('3. Pending tasks', open.slice(0, 10).map(taskLine), 'Nothing pending.'),
      ...section('4. Missed or delayed deadlines', [...missed.map((x) => `${taskLine(x)} (missed today)`), ...olderOverdue.map((x) => `${taskLine(x)} (still overdue)`)]),
      ...section('5. Important conversations', mailLines(mail)),
      ...section('6. Carry forward to tomorrow', carry.map((r) => `${r.task.title} (${r.why})`), 'Nothing to carry forward.'),
      ...section(`7. Tomorrow's meetings (${tmr.label})`, tmr.events.map((e) => `${e.all_day ? 'All day' : t(e.starts_at)} ${e.title}${e.location ? ' @ ' + e.location : ''}`), 'No meetings scheduled.'),
      ...section('8. Tomorrow\'s priorities', tmrPriorities.map((r) => `${r.task.title} (${r.why})`), 'No open tasks — plan tomorrow in JARVIS.'),
      '', 'A status update for your manager/team is saved in Email → Drafts. It will not be sent unless you approve it.',
    ];

    const name = config.userName || '';
    const update = [
      'Hi,',
      '',
      `Here is my update for ${formatDay(now, tz())}.`,
      '',
      'Completed today:',
      ...bullets(done.map((x) => x.title), 'No items closed today.'),
      '',
      'In progress / next:',
      ...bullets(carry.slice(0, 5).map((r) => r.task.title), 'Nothing outstanding.'),
      ...(missed.length || olderOverdue.length ? ['', 'Delayed:', ...bullets([...missed, ...olderOverdue].slice(0, 5).map((x) => `${x.title} (was due ${shortDay(x.due_at)})`))] : []),
      '',
      'Tomorrow:',
      ...bullets(tmrPriorities.map((r) => r.task.title), 'Planning in progress.'),
      '',
      'Thanks,',
      name || '',
    ].join('\n').trimEnd();

    return {
      text: lines.join('\n'),
      data: { done: done.length, open: open.length, missed: missed.length + olderOverdue.length },
      summary: `${done.length} done · ${open.length} open · ${missed.length + olderOverdue.length} delayed — manager update drafted`,
      draft: {
        kind: 'status_update',
        recipient: config.env.REPORT_MANAGER_EMAIL || '',
        subject: `Status update — ${new Intl.DateTimeFormat('en-IN', { timeZone: tz(), weekday: 'short', day: 'numeric', month: 'short' }).format(now)}`,
        body: update,
      },
    };
  }

  // ───────────── Weekly ─────────────
  async function weekly(now) {
    const week = weekStart(now, tz());
    const from = week.start;
    const nextWeekStart = dayBounds(from, tz(), 7).start;
    const nextWeekEnd = dayBounds(from, tz(), 14).start;
    const done = completedBetween(from, now);
    const open = openTasks();
    const late = overdue(now);
    const stuck = open.filter((x) => x.status === 'in_progress' && Date.parse(x.updated_at) < now.getTime() - 3 * 86400e3);
    const upcoming = dueBetween(now, new Date(now.getTime() + 14 * 86400e3));
    const decisions = q("SELECT * FROM memories WHERE category = 'decision' AND updated_at >= ? ORDER BY updated_at", from.toISOString());
    const meetings = events.between(from, now);
    const nextWeekEvents = events.between(nextWeekStart, nextWeekEnd);
    const nextPriorities = rank(open, nextWeekStart, dayBounds(nextWeekStart, tz(), 1).start).slice(0, 5);

    const byProject = new Map();
    for (const x of done) {
      const k = x.project || 'General';
      byProject.set(k, (byProject.get(k) || 0) + 1);
    }

    // Organization suggestions (suggest only — nothing is deleted or moved).
    const tips = [];
    const noProject = open.filter((x) => !x.project).length;
    if (noProject >= 3) tips.push(`Tasks: ${noProject} open tasks have no project — tag them so weekly progress groups correctly.`);
    const noDue = open.filter((x) => !x.due_at && x.priority !== 'upcoming').length;
    if (noDue >= 3) tips.push(`Tasks: ${noDue} active tasks have no due date — add dates or move them to Upcoming.`);
    const stale = open.filter((x) => Date.parse(x.updated_at) < now.getTime() - 14 * 86400e3).length;
    if (stale) tips.push(`Tasks: ${stale} task${stale > 1 ? 's have' : ' has'} not been touched in 2+ weeks — review: still relevant, reschedule, or cancel?`);
    const oldDrafts = drafts.list().filter((d) => Date.parse(d.updated_at) < now.getTime() - 7 * 86400e3).length;
    if (oldDrafts) tips.push(`Drafts: ${oldDrafts} draft${oldDrafts > 1 ? 's are' : ' is'} over a week old — send, edit or discard.`);
    const oldMemories = memory.list({ limit: 500 }).filter((m) => ['project', 'deadline'].includes(m.category) && Date.parse(m.updated_at) < now.getTime() - 30 * 86400e3).length;
    if (oldMemories) tips.push(`Memory: ${oldMemories} project/deadline note${oldMemories > 1 ? 's are' : ' is'} over 30 days old — confirm they are still accurate.`);
    if (!integrations.google.connected) tips.push('Inbox: connect Gmail so weekly reviews can include inbox clean-up suggestions.');
    else tips.push('Inbox: archive threads you have already answered; use Gmail labels per project to match your task projects.');
    tips.push('Meeting notes: save key decisions with "Remember: decision — …" so they appear in next week\'s review.');
    tips.push('Documents & folders: keep one folder per project with the same names as your task projects.');

    const lines = [
      `📊 Weekly review — week of ${formatDay(from, tz())}`,
      `Completed: ${done.length} · Open: ${open.length} · Overdue: ${late.length}`,
      ...section('Major achievements', done.filter((x) => x.priority === 'top' || x.priority === 'important').map((x) => x.title), 'No top or important tasks finished this week.'),
      ...section('Projects progressed', [...byProject].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}: ${n} task${n > 1 ? 's' : ''} completed`), 'No completed work recorded.'),
      ...section('Tasks completed', done.map((x) => `${x.title} (${shortDay(x.completed_at)})`)),
      ...section('Outstanding responsibilities', open.slice(0, 10).map(taskLine), 'Nothing open.'),
      ...section('Blockers', [...late.map((x) => `${taskLine(x)} (overdue)`), ...stuck.map((x) => `${x.title} (in progress, no update for 3+ days)`)]),
      ...section('Upcoming deadlines (next 14 days)', upcoming.map(taskLine)),
      ...section('Important decisions', decisions.map((m) => m.content), 'No decisions recorded in memory this week.'),
      ...section('Meetings this week', meetings.map((e) => `${shortDay(e.starts_at)} ${e.title}`)),
      ...section('Next week — scheduled', nextWeekEvents.map((e) => `${shortDay(e.starts_at)} ${e.all_day ? '' : t(e.starts_at) + ' '}${e.title}`), 'Nothing scheduled yet.'),
      ...section('Next week\'s priorities', nextPriorities.map((r) => `${r.task.title} (${r.why})`), 'No open tasks.'),
      ...section('Organization suggestions', tips),
      '', 'Suggestions only — JARVIS has not deleted, moved or shared anything.',
    ];
    return {
      text: lines.join('\n'),
      data: { done: done.length, open: open.length, overdue: late.length, projects: Object.fromEntries(byProject) },
      summary: `${done.length} completed · ${open.length} open · ${late.length} overdue`,
      periodKey: week.dateKey,
    };
  }

  const BUILDERS = { midday, end_of_day: endOfDay, weekly };
  const hydrate = (r) => r && { ...r, data: JSON.parse(r.data) };

  return {
    TYPES: REPORT_TYPES,
    TITLES,
    get(rid) {
      const r = hydrate(db.prepare('SELECT * FROM reports WHERE id = ?').get(vid(rid)));
      if (!r) throw new NotFoundError(`Report ${rid} not found.`);
      return r;
    },
    list({ type, limit = 30 } = {}) {
      const lim = Math.min(Number(limit) || 30, 100);
      const rows = type
        ? q('SELECT id, type, period_key, title, data, draft_id, created_at FROM reports WHERE type = ? ORDER BY id DESC LIMIT ?', type, lim)
        : q('SELECT id, type, period_key, title, data, draft_id, created_at FROM reports ORDER BY id DESC LIMIT ?', lim);
      return rows.map(hydrate);
    },
    latest(type) {
      return hydrate(db.prepare('SELECT * FROM reports WHERE type = ? ORDER BY id DESC LIMIT 1').get(type)) || null;
    },
    // Builds the report and stores it. For end-of-day, creates or refreshes the
    // day's manager-update draft (never sends it).
    async generate(type, { now = new Date(), actor = 'user' } = {}) {
      if (!REPORT_TYPES.includes(type)) throw new ValidationError(`Report type must be one of: ${REPORT_TYPES.join(', ')}.`);
      const built = await BUILDERS[type](now);
      const periodKey = built.periodKey || dayBounds(now, tz(), 0).dateKey;
      const title = `${TITLES[type]} — ${type === 'weekly' ? 'week of ' : ''}${periodKey}`;
      let draftId = null;
      if (built.draft) {
        const prev = db.prepare('SELECT draft_id FROM reports WHERE type = ? AND period_key = ? AND draft_id IS NOT NULL ORDER BY id DESC LIMIT 1').get(type, periodKey);
        const prevDraft = prev && db.prepare("SELECT * FROM drafts WHERE id = ? AND status = 'draft'").get(prev.draft_id);
        draftId = prevDraft
          ? drafts.update(prevDraft.id, { subject: built.draft.subject, body: built.draft.body }, 'reports').id
          : drafts.create(built.draft, 'reports').id;
      }
      const r = db.prepare('INSERT INTO reports (type, period_key, title, content, data, draft_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(type, periodKey, title, built.text, JSON.stringify({ ...built.data, summary: built.summary }), draftId, nowIso());
      const report = this.get(Number(r.lastInsertRowid));
      activity.log('report.generated', `${TITLES[type]} generated`, { id: report.id, actor });
      return report;
    },
  };
}
