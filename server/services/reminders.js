import { nowIso, parseFutureDate, ValidationError } from '../lib/time.js';
import { str, id as vid, NotFoundError } from './validate.js';

export function createReminderService(db, activity, notifications) {
  const get = (rid) => {
    const r = db.prepare('SELECT * FROM reminders WHERE id = ?').get(vid(rid));
    if (!r) throw new NotFoundError(`Reminder ${rid} not found.`);
    return r;
  };
  return {
    get,
    list({ includeDone = false } = {}) {
      return db.prepare(`SELECT * FROM reminders ${includeDone ? '' : "WHERE status = 'scheduled'"} ORDER BY remind_at`).all();
    },
    create(input, actor = 'user') {
      const message = str(input.message, 'message', { required: true, max: 500 });
      const when = parseFutureDate(input.remind_at);
      if (!when) throw new ValidationError('remind_at is required.');
      if (when.getTime() < Date.now() - 60_000) throw new ValidationError('remind_at is in the past.');
      const taskId = input.task_id ? vid(input.task_id, 'task_id') : null;
      const r = db.prepare('INSERT INTO reminders (message, remind_at, task_id, created_at) VALUES (?, ?, ?, ?)')
        .run(message, when.toISOString(), taskId, nowIso());
      const rem = get(Number(r.lastInsertRowid));
      activity.log('reminder.created', `Reminder set: ${message}`, { id: rem.id, remind_at: rem.remind_at, actor });
      return rem;
    },
    update(rid, input, actor = 'user') {
      const rem = get(rid);
      if (rem.status !== 'scheduled') throw new ValidationError('Only scheduled reminders can be changed.');
      const message = input.message !== undefined ? str(input.message, 'message', { required: true, max: 500 }) : rem.message;
      const when = input.remind_at !== undefined ? parseFutureDate(input.remind_at) : new Date(rem.remind_at);
      if (!when) throw new ValidationError('remind_at cannot be empty.');
      db.prepare('UPDATE reminders SET message = ?, remind_at = ? WHERE id = ?').run(message, when.toISOString(), rem.id);
      activity.log('reminder.updated', `Reminder updated: ${message}`, { id: rem.id, actor });
      return get(rem.id);
    },
    cancel(rid, actor = 'user') {
      const rem = get(rid);
      if (rem.status !== 'scheduled') throw new ValidationError(`Reminder ${rem.id} is already ${rem.status}.`);
      db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ?").run(rem.id);
      activity.log('reminder.cancelled', `Reminder cancelled: ${rem.message}`, { id: rem.id, actor });
      return get(rem.id);
    },
    // Called by the ticker. The conditional UPDATE guarantees a reminder fires once
    // even if two ticks overlap.
    fireDue(now = new Date()) {
      const due = db.prepare("SELECT * FROM reminders WHERE status = 'scheduled' AND remind_at <= ?").all(now.toISOString());
      const fired = [];
      for (const rem of due) {
        const res = db.prepare("UPDATE reminders SET status = 'fired', fired_at = ? WHERE id = ? AND status = 'scheduled'")
          .run(nowIso(), rem.id);
        if (res.changes === 1) {
          notifications.create({ title: 'Reminder', body: rem.message, level: 'warning', link: '#/tasks' });
          activity.log('reminder.fired', `Reminder fired: ${rem.message}`, { id: rem.id });
          fired.push(rem);
        }
      }
      return fired;
    },
  };
}
