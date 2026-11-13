// Builds a day's schedule from JARVIS's own data: events, tasks due, reminders,
// and open top priorities. Deterministic — no AI call, so the nightly briefing
// works even when the AI provider is down.
import { dayBounds, boundsForDateKey, formatTime } from '../lib/time.js';

export function createScheduleService({ events, tasks, reminders, db }, config) {
  const tz = () => config.timezone;

  function resolve(day = 'today', now = new Date()) {
    if (day === 'today') return dayBounds(now, tz(), 0);
    if (day === 'tomorrow') return dayBounds(now, tz(), 1);
    return boundsForDateKey(day, tz());
  }

  function forDay(day = 'today', now = new Date()) {
    const { start, end, dateKey } = resolve(day, now);
    const s = start.toISOString();
    const e = end.toISOString();
    const dueTasks = db.prepare(`SELECT * FROM tasks WHERE status IN ('pending','in_progress') AND due_at >= ? AND due_at < ? ORDER BY due_at`).all(s, e);
    const overdue = db.prepare(`SELECT * FROM tasks WHERE status IN ('pending','in_progress') AND due_at < ? ORDER BY due_at`).all(s);
    const dayReminders = db.prepare(`SELECT * FROM reminders WHERE status = 'scheduled' AND remind_at >= ? AND remind_at < ? ORDER BY remind_at`).all(s, e);
    const top = tasks.list({ priority: 'top' }).filter((t) => !dueTasks.some((d) => d.id === t.id)).slice(0, 3);
    return {
      date: dateKey,
      label: new Intl.DateTimeFormat('en-IN', { timeZone: tz(), weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(start.getTime() + 12 * 3600e3)),
      timezone: tz(),
      events: events.between(start, end),
      tasksDue: dueTasks,
      overdue,
      reminders: dayReminders,
      topPriorities: top,
    };
  }

  // Plain-text rendering used for notifications and WhatsApp.
  function toText(sch, heading = 'Your schedule') {
    const t = (iso) => formatTime(new Date(iso), tz());
    const lines = [`${heading} — ${sch.label}`];
    const empty = !sch.events.length && !sch.tasksDue.length && !sch.reminders.length;
    if (sch.events.length) {
      lines.push('', 'Events:');
      for (const ev of sch.events) lines.push(`• ${ev.all_day ? 'All day' : t(ev.starts_at) + (ev.ends_at ? '–' + t(ev.ends_at) : '')} ${ev.title}${ev.location ? ' @ ' + ev.location : ''}`);
    }
    if (sch.tasksDue.length) {
      lines.push('', 'Due:');
      for (const x of sch.tasksDue) lines.push(`• ${t(x.due_at)} ${x.title}`);
    }
    if (sch.reminders.length) {
      lines.push('', 'Reminders:');
      for (const r of sch.reminders) lines.push(`• ${t(r.remind_at)} ${r.message}`);
    }
    if (sch.topPriorities.length) {
      lines.push('', 'Top priorities:');
      for (const x of sch.topPriorities) lines.push(`• ${x.title}${x.reason ? ' — ' + x.reason : ''}`);
    }
    if (sch.overdue.length) lines.push('', `⚠ ${sch.overdue.length} overdue task${sch.overdue.length > 1 ? 's' : ''}: ${sch.overdue.slice(0, 3).map((x) => x.title).join('; ')}`);
    if (empty) lines.push('', 'Nothing is scheduled yet. Open JARVIS and tell me your plans so I can organize your day.');
    return lines.join('\n');
  }

  return { forDay, toText, resolve };
}
