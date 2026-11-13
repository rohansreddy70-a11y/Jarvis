// Long-term memory: user-visible, editable, searchable. Rejects credentials.
// Conversation history (short-term context) lives separately in `messages`.
import { nowIso, ValidationError } from '../lib/time.js';
import { containsSecret } from '../lib/secrets.js';
import { str, oneOf, id as vid, NotFoundError } from './validate.js';

export const MEMORY_CATEGORIES = ['preference', 'writing_style', 'project', 'deadline', 'decision', 'instruction', 'contact', 'other'];

function guard(content) {
  if (containsSecret(content)) {
    throw new ValidationError('This looks like a password, API key or other credential. JARVIS does not store credentials in memory — put them in your .env file instead.');
  }
}

export function createMemoryService(db, activity) {
  const get = (mid) => {
    const m = db.prepare('SELECT * FROM memories WHERE id = ?').get(vid(mid));
    if (!m) throw new NotFoundError(`Memory ${mid} not found.`);
    return m;
  };
  return {
    CATEGORIES: MEMORY_CATEGORIES,
    get,
    list({ category, query, limit = 200 } = {}) {
      const where = [];
      const args = [];
      if (category) { where.push('category = ?'); args.push(oneOf(category, 'category', MEMORY_CATEGORIES)); }
      if (query) {
        // Every word must appear somewhere (case-insensitive).
        for (const word of String(query).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
          where.push("lower(content) LIKE ? ESCAPE '\\'");
          args.push(`%${word.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
        }
      }
      return db.prepare(`SELECT * FROM memories ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`)
        .all(...args, Math.min(Number(limit) || 200, 500));
    },
    create(input, actor = 'user') {
      const content = str(input.content, 'content', { required: true, max: 2000 });
      guard(content);
      const category = oneOf(input.category, 'category', MEMORY_CATEGORIES) || 'other';
      const ts = nowIso();
      const r = db.prepare('INSERT INTO memories (category, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(category, content, actor, ts, ts);
      const m = get(Number(r.lastInsertRowid));
      activity.log('memory.created', `Memory saved (${category})`, { id: m.id, actor });
      return m;
    },
    update(mid, input, actor = 'user') {
      const m = get(mid);
      const content = input.content !== undefined ? str(input.content, 'content', { required: true, max: 2000 }) : m.content;
      guard(content);
      const category = input.category !== undefined ? oneOf(input.category, 'category', MEMORY_CATEGORIES, { required: true }) : m.category;
      db.prepare('UPDATE memories SET content = ?, category = ?, updated_at = ? WHERE id = ?').run(content, category, nowIso(), m.id);
      activity.log('memory.updated', `Memory corrected (${category})`, { id: m.id, actor });
      return get(m.id);
    },
    remove(mid, actor = 'user') {
      const m = get(mid);
      db.prepare('DELETE FROM memories WHERE id = ?').run(m.id);
      activity.log('memory.deleted', `Memory deleted (${m.category})`, { id: m.id, actor });
      return m;
    },
  };
}
