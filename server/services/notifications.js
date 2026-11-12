import { nowIso } from '../lib/time.js';
import { id as vid } from './validate.js';

export function createNotificationService(db) {
  return {
    create({ title, body = '', level = 'info', link = null }) {
      const r = db.prepare('INSERT INTO notifications (title, body, level, link, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(title, body, level, link, nowIso());
      return Number(r.lastInsertRowid);
    },
    list({ unreadOnly = false, limit = 50 } = {}) {
      const sql = `SELECT * FROM notifications ${unreadOnly ? 'WHERE read = 0' : ''} ORDER BY id DESC LIMIT ?`;
      return db.prepare(sql).all(Math.min(Number(limit) || 50, 200)).map((n) => ({ ...n, read: Boolean(n.read) }));
    },
    unreadCount() {
      return db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE read = 0').get().c;
    },
    markRead(nid) {
      db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(vid(nid));
    },
    markAllRead() {
      db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
    },
  };
}
