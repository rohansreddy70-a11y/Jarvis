import { nowIso } from '../lib/time.js';
import { str, oneOf, id as vid, NotFoundError } from './validate.js';

export function createDraftService(db, activity) {
  const get = (did) => {
    const d = db.prepare('SELECT * FROM drafts WHERE id = ?').get(vid(did));
    if (!d) throw new NotFoundError(`Draft ${did} not found.`);
    return d;
  };
  return {
    get,
    list({ includeClosed = false } = {}) {
      return db.prepare(`SELECT * FROM drafts ${includeClosed ? '' : "WHERE status IN ('draft','pending_approval')"} ORDER BY id DESC`).all();
    },
    create(input, actor = 'user') {
      const kind = oneOf(input.kind, 'kind', ['email', 'message', 'status_update']) || 'email';
      const ts = nowIso();
      const r = db.prepare('INSERT INTO drafts (kind, recipient, subject, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        kind, str(input.recipient, 'recipient', { max: 500 }) || '', str(input.subject, 'subject', { max: 300 }) || '',
        str(input.body, 'body', { required: true, max: 20000 }), ts, ts,
      );
      const d = get(Number(r.lastInsertRowid));
      activity.log('draft.created', `Draft ${kind} prepared${d.recipient ? ' for ' + d.recipient : ''}`, { id: d.id, actor });
      return d;
    },
    update(did, input, actor = 'user') {
      const d = get(did);
      const next = {
        recipient: input.recipient !== undefined ? str(input.recipient, 'recipient', { max: 500 }) ?? '' : d.recipient,
        subject: input.subject !== undefined ? str(input.subject, 'subject', { max: 300 }) ?? '' : d.subject,
        body: input.body !== undefined ? str(input.body, 'body', { required: true, max: 20000 }) : d.body,
      };
      db.prepare('UPDATE drafts SET recipient = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?')
        .run(next.recipient, next.subject, next.body, nowIso(), d.id);
      activity.log('draft.updated', 'Draft edited', { id: d.id, actor });
      return get(d.id);
    },
    setStatus(did, status) {
      db.prepare('UPDATE drafts SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), vid(did));
      return get(did);
    },
    discard(did, actor = 'user') {
      const d = get(did);
      db.prepare("UPDATE drafts SET status = 'discarded', updated_at = ? WHERE id = ?").run(nowIso(), d.id);
      activity.log('draft.discarded', 'Draft discarded', { id: d.id, actor });
      return get(d.id);
    },
  };
}
