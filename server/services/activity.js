// Append-only activity log. Everything is redacted before it is written.
import { nowIso } from '../lib/time.js';
import { redact, redactDeep } from '../lib/secrets.js';

export function createActivityService(db) {
  const insert = db.prepare('INSERT INTO activity_log (type, message, meta, created_at) VALUES (?, ?, ?, ?)');
  return {
    log(type, message, meta = {}) {
      insert.run(type, redact(String(message)), JSON.stringify(redactDeep(meta)), nowIso());
    },
    list({ limit = 100, type } = {}) {
      const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
      const rows = type
        ? db.prepare('SELECT * FROM activity_log WHERE type = ? ORDER BY id DESC LIMIT ?').all(type, lim)
        : db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(lim);
      return rows.map((r) => ({ ...r, meta: JSON.parse(r.meta) }));
    },
  };
}
