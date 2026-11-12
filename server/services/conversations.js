// Short-term conversation context, kept separate from long-term memory.
import { nowIso } from '../lib/time.js';
import { id as vid, NotFoundError } from './validate.js';

export function createConversationService(db) {
  const get = (cid) => {
    const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(vid(cid));
    if (!c) throw new NotFoundError(`Conversation ${cid} not found.`);
    return c;
  };
  return {
    get,
    list() {
      return db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100').all();
    },
    create(title = 'New conversation') {
      const ts = nowIso();
      const r = db.prepare('INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)').run(title.slice(0, 120), ts, ts);
      return get(Number(r.lastInsertRowid));
    },
    rename(cid, title) {
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(String(title).slice(0, 120), vid(cid));
    },
    remove(cid) {
      db.prepare('DELETE FROM conversations WHERE id = ?').run(vid(cid));
    },
    addMessage(cid, { role, content = '', tool_calls = null, tool_call_id = null }) {
      const ts = nowIso();
      db.prepare('INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(vid(cid), role, content ?? '', tool_calls ? JSON.stringify(tool_calls) : null, tool_call_id, ts);
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(ts, cid);
    },
    // Full history in provider format (for the model).
    history(cid, limit = 40) {
      const rows = db.prepare('SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id').all(vid(cid), limit);
      // Never start the window on an orphaned tool result.
      while (rows.length && rows[0].role === 'tool') rows.shift();
      return rows.map((m) => {
        const msg = { role: m.role, content: m.content };
        if (m.tool_calls) msg.tool_calls = JSON.parse(m.tool_calls);
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        return msg;
      });
    },
    // Visible transcript (for the UI).
    transcript(cid) {
      return db.prepare("SELECT id, role, content, tool_calls, created_at FROM messages WHERE conversation_id = ? AND role != 'tool' ORDER BY id")
        .all(vid(cid))
        .filter((m) => m.content || m.role === 'user')
        .map((m) => ({ id: m.id, role: m.role, content: m.content, created_at: m.created_at }));
    },
  };
}
