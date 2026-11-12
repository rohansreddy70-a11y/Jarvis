// Built-in calendar. Events are JARVIS's own data (no external calendar needed).
import { nowIso, parseFutureDate, ValidationError } from '../lib/time.js';
import { str, id as vid, NotFoundError } from './validate.js';

export function createEventService(db, activity) {
  const hydrate = (e) => e && { ...e, all_day: Boolean(e.all_day) };
  const get = (eid) => {
    const e = hydrate(db.prepare('SELECT * FROM events WHERE id = ?').get(vid(eid)));
    if (!e) throw new NotFoundError(`Event ${eid} not found.`);
    return e;
  };
  const times = (startsRaw, endsRaw) => {
    const s = parseFutureDate(startsRaw);
    if (!s) throw new ValidationError('starts_at is required.');
    const e = parseFutureDate(endsRaw);
    if (e && e < s) throw new ValidationError('ends_at must be after starts_at.');
    return [s.toISOString(), e ? e.toISOString() : null];
  };
  return {
    get,
    // Events overlapping [from, to).
    between(from, to) {
      return db.prepare(`SELECT * FROM events
        WHERE starts_at < ? AND COALESCE(ends_at, starts_at) >= ? ORDER BY starts_at, id`)
        .all(to.toISOString(), from.toISOString()).map(hydrate);
    },
    create(input, actor = 'user') {
      const title = str(input.title, 'title', { required: true, max: 300 });
      const [s, e] = times(input.starts_at, input.ends_at);
      const ts = nowIso();
      const r = db.prepare(`INSERT INTO events (title, starts_at, ends_at, all_day, location, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(title, s, e, input.all_day ? 1 : 0,
        str(input.location, 'location', { max: 300 }) || '', str(input.notes, 'notes') || '', ts, ts);
      const ev = get(Number(r.lastInsertRowid));
      activity.log('event.created', `Event added: ${ev.title}`, { id: ev.id, starts_at: s, actor });
      return ev;
    },
    update(eid, input, actor = 'user') {
      const ev = get(eid);
      const [s, e] = times(input.starts_at ?? ev.starts_at, input.ends_at !== undefined ? input.ends_at : ev.ends_at);
      const title = input.title !== undefined ? str(input.title, 'title', { required: true, max: 300 }) : ev.title;
      const location = input.location !== undefined ? str(input.location, 'location', { max: 300 }) ?? '' : ev.location;
      const notes = input.notes !== undefined ? str(input.notes, 'notes') ?? '' : ev.notes;
      const allDay = input.all_day !== undefined ? (input.all_day ? 1 : 0) : (ev.all_day ? 1 : 0);
      db.prepare('UPDATE events SET title=?, starts_at=?, ends_at=?, all_day=?, location=?, notes=?, updated_at=? WHERE id=?')
        .run(title, s, e, allDay, location, notes, nowIso(), ev.id);
      activity.log('event.updated', `Event updated: ${title}`, { id: ev.id, actor });
      return get(ev.id);
    },
    remove(eid, actor = 'user') {
      const ev = get(eid);
      db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
      activity.log('event.deleted', `Event deleted: ${ev.title}`, { id: ev.id, actor });
      return ev;
    },
  };
}
