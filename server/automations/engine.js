// Automation engine: time-zone-aware daily workflows with enable/disable,
// configurable time and channels, execution history, failure notifications,
// and duplicate-execution prevention (UNIQUE(automation_id, run_key)).
import { nowIso, localParts, localWeekday, ValidationError } from '../lib/time.js';
import { NotFoundError } from '../services/validate.js';

const CATCH_UP_MINUTES = 180; // if JARVIS was off at the scheduled time, still run within 3h
export const CHANNELS = ['in_app', 'whatsapp'];

export function createAutomationEngine({ db, config, services, whatsapp }) {
  const { activity, notifications, schedule, reports } = services;
  const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
  const report = (type) => async () => {
    const r = await reports.generate(type, { actor: 'automation' });
    return { text: r.content, summary: r.data.summary, link: `#/reports/${r.id}` };
  };

  const DEFINITIONS = {
    bedtime_schedule: {
      name: 'Bedtime: tomorrow\'s schedule',
      description: 'Every night, sends you tomorrow\'s events, deadlines, reminders and top priorities. If nothing is planned, it asks you to plan tomorrow.',
      defaultTime: config.env.JARVIS_BEDTIME_BRIEFING || '21:30',
      defaultEnabled: true, // explicitly requested by the owner
      defaultChannels: ['in_app', 'whatsapp'],
      build: () => schedule.toText(schedule.forDay('tomorrow'), "🌙 Tomorrow's schedule"),
      link: '#/calendar',
    },
    morning_schedule: {
      name: 'Morning: today\'s schedule',
      description: 'Each morning, sends today\'s events, deadlines, reminders and top priorities.',
      defaultTime: '07:30',
      defaultEnabled: false,
      defaultChannels: ['in_app'],
      build: () => schedule.toText(schedule.forDay('today'), "☀️ Today's schedule"),
      link: '#/today',
    },
    midday_checkin: {
      name: 'Midday check-in',
      description: 'Done vs pending, delays, upcoming deadlines, potential problems, new important emails, schedule changes, and a suggested order for the rest of the day.',
      defaultTime: '13:00',
      defaultEnabled: true,
      defaultChannels: ['in_app'],
      defaultDays: [1, 2, 3, 4, 5],
      report: 'midday',
      build: report('midday'),
    },
    end_of_day: {
      name: 'End-of-day wrap-up',
      description: 'Work completed, achievements, pending and delayed items, important conversations, carry-forwards, tomorrow\'s meetings and priorities — plus a manager status update saved as a draft for your approval.',
      defaultTime: '18:30',
      defaultEnabled: true,
      defaultChannels: ['in_app'],
      defaultDays: [1, 2, 3, 4, 5],
      report: 'end_of_day',
      build: report('end_of_day'),
    },
    weekly_review: {
      name: 'Weekly review',
      description: 'Achievements, projects progressed, outstanding work, blockers, upcoming deadlines, decisions, next week\'s priorities and organization suggestions.',
      defaultTime: '17:30',
      defaultEnabled: true,
      defaultChannels: ['in_app'],
      defaultDays: [5],
      report: 'weekly',
      build: report('weekly'),
    },
  };

  // Seed rows once; afterwards the user's settings win.
  for (const [id, d] of Object.entries(DEFINITIONS)) {
    db.prepare('INSERT OR IGNORE INTO automations (id, enabled, run_at, channels, days, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, d.defaultEnabled ? 1 : 0, validTime(d.defaultTime) ? d.defaultTime : '21:30', JSON.stringify(d.defaultChannels), JSON.stringify(d.defaultDays || ALL_DAYS), nowIso());
  }

  const row = (id) => {
    const r = db.prepare('SELECT * FROM automations WHERE id = ?').get(id);
    if (!r || !DEFINITIONS[id]) throw new NotFoundError(`Automation "${id}" not found.`);
    return r;
  };
  const view = (r) => {
    const d = DEFINITIONS[r.id];
    const last = db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY id DESC LIMIT 1').get(r.id) || null;
    return {
      id: r.id, name: d.name, description: d.description, enabled: Boolean(r.enabled), run_at: r.run_at,
      timezone: config.timezone, channels: JSON.parse(r.channels), days: JSON.parse(r.days), report: d.report || null, lastRun: last,
    };
  };

  async function execute(id, runKey, trigger) {
    const claim = db.prepare('INSERT OR IGNORE INTO automation_runs (automation_id, run_key, trigger, started_at) VALUES (?, ?, ?, ?)')
      .run(id, runKey, trigger, nowIso());
    if (claim.changes !== 1) return null; // already ran for this slot
    const runId = Number(claim.lastInsertRowid);
    const d = DEFINITIONS[id];
    const channels = JSON.parse(row(id).channels);
    let output = '';
    const results = [];
    try {
      const built = await d.build();
      const { text, summary, link } = typeof built === 'string' ? { text: built, summary: built, link: d.link } : built;
      output = text;
      if (channels.includes('in_app')) {
        notifications.create({ title: d.name, body: summary, level: 'info', link });
        results.push({ channel: 'in_app', ok: true });
      }
      if (channels.includes('whatsapp')) {
        try {
          const msgId = await whatsapp.notifyOwner(output);
          results.push({ channel: 'whatsapp', ok: true, id: msgId });
        } catch (err) {
          results.push({ channel: 'whatsapp', ok: false, error: err.message });
        }
      }
    } catch (err) {
      results.push({ channel: 'build', ok: false, error: err.message });
    }
    const failed = results.filter((r) => !r.ok);
    const status = !failed.length ? 'success' : failed.length === results.length ? 'failed' : 'partial';
    const error = failed.map((f) => `${f.channel}: ${f.error}`).join('; ') || null;
    db.prepare('UPDATE automation_runs SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?').run(status, output, error, nowIso(), runId);
    activity.log(`automation.${status}`, `${d.name}: ${status}${error ? ' — ' + error : ''}`, { id, runKey, trigger, channels: results.map((r) => r.channel) });
    if (failed.length) notifications.create({ title: `${d.name} — delivery problem`, body: error, level: 'error', link: '#/automations' });
    return db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(runId);
  }

  return {
    CHANNELS,
    list: () => Object.keys(DEFINITIONS).map((id) => view(row(id))),
    get: (id) => view(row(id)),
    update(id, input) {
      const r = row(id);
      const enabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : r.enabled;
      let runAt = r.run_at;
      if (input.run_at !== undefined) {
        if (!validTime(input.run_at)) throw new ValidationError('Time must be HH:MM (24-hour), e.g. 21:30.');
        runAt = input.run_at;
      }
      let channels = JSON.parse(r.channels);
      if (input.channels !== undefined) {
        if (!Array.isArray(input.channels) || !input.channels.length || input.channels.some((c) => !CHANNELS.includes(c))) {
          throw new ValidationError(`channels must be a non-empty list of: ${CHANNELS.join(', ')}.`);
        }
        channels = [...new Set(input.channels)];
      }
      let days = JSON.parse(r.days);
      if (input.days !== undefined) {
        if (!Array.isArray(input.days) || !input.days.length || input.days.some((d) => !ALL_DAYS.includes(d))) {
          throw new ValidationError('days must be a non-empty list of weekday numbers 1 (Mon) – 7 (Sun).');
        }
        days = [...new Set(input.days)].sort();
      }
      db.prepare('UPDATE automations SET enabled = ?, run_at = ?, channels = ?, days = ?, updated_at = ? WHERE id = ?')
        .run(enabled, runAt, JSON.stringify(channels), JSON.stringify(days), nowIso(), id);
      activity.log('automation.updated', `${DEFINITIONS[id].name}: ${enabled ? `on at ${runAt}` : 'off'} (${channels.join(', ')})`, { id });
      return view(row(id));
    },
    runs: (id, limit = 30) => { row(id); return db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY id DESC LIMIT ?').all(id, limit); },
    runNow: (id) => { row(id); return execute(id, `manual-${Date.now()}`, 'manual'); },
    // Preview without side effects. Reports are stored when generated, so they have no preview.
    preview: async (id) => { row(id); return DEFINITIONS[id].report ? null : DEFINITIONS[id].build(); },
    // Called every tick. Runs each enabled automation at most once per local day.
    async tick(now = new Date()) {
      const { dateKey, minutes } = localParts(now, config.timezone);
      const weekday = localWeekday(now, config.timezone);
      const ran = [];
      for (const id of Object.keys(DEFINITIONS)) {
        const r = row(id);
        if (!r.enabled || !JSON.parse(r.days).includes(weekday)) continue;
        const [hh, mm] = r.run_at.split(':').map(Number);
        const due = hh * 60 + mm;
        if (minutes >= due && minutes - due <= CATCH_UP_MINUTES) {
          const res = await execute(id, dateKey, 'schedule');
          if (res) ran.push(res);
        }
      }
      return ran;
    },
  };
}

function validTime(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
