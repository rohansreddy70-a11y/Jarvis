// Approval gate for sensitive actions (sending, deleting, sharing).
// The assistant can only *request* these actions. Nothing runs until the user
// confirms in the UI, and the result reported back is whatever the executor
// actually returned — never an assumed success.
import { nowIso, ValidationError } from '../lib/time.js';
import { redact } from '../lib/secrets.js';
import { id as vid, NotFoundError } from './validate.js';

export function createApprovalService(db, activity, notifications) {
  const executors = new Map(); // action_type -> { label, execute(payload) => result string }

  const hydrate = (row) => row && { ...row, payload: JSON.parse(row.payload) };
  const get = (aid) => {
    const a = hydrate(db.prepare('SELECT * FROM approvals WHERE id = ?').get(vid(aid)));
    if (!a) throw new NotFoundError(`Approval ${aid} not found.`);
    return a;
  };

  return {
    get,
    registerExecutor(actionType, executor) {
      executors.set(actionType, executor);
    },
    actionTypes: () => [...executors.keys()],
    list({ status } = {}) {
      const rows = status
        ? db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY id DESC').all(status)
        : db.prepare('SELECT * FROM approvals ORDER BY id DESC LIMIT 200').all();
      return rows.map(hydrate);
    },
    pendingCount() {
      return db.prepare("SELECT COUNT(*) AS c FROM approvals WHERE status = 'pending'").get().c;
    },
    request({ actionType, target = '', summary, content = '', payload = {} }, requestedBy = 'assistant') {
      if (!executors.has(actionType)) throw new ValidationError(`Unknown action type "${actionType}".`);
      const r = db.prepare(`INSERT INTO approvals (action_type, target, summary, content, payload, requested_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(actionType, redact(target), redact(summary), redact(content), JSON.stringify(payload), requestedBy, nowIso());
      const a = get(Number(r.lastInsertRowid));
      activity.log('approval.requested', `Approval requested: ${a.summary}`, { id: a.id, actionType, requestedBy });
      notifications.create({ title: 'Approval needed', body: a.summary, level: 'warning', link: `#/approvals/${a.id}` });
      return a;
    },
    async confirm(aid) {
      const a = get(aid);
      // Atomic claim: only one confirm can move it out of 'pending'.
      const claim = db.prepare("UPDATE approvals SET status = 'failed', decided_at = ?, result = 'executing' WHERE id = ? AND status = 'pending'")
        .run(nowIso(), a.id);
      if (claim.changes !== 1) throw new ValidationError(`Approval ${a.id} is already ${a.status}.`);
      const exec = executors.get(a.action_type);
      let status = 'executed';
      let result;
      try {
        result = String(await exec.execute(a.payload));
      } catch (err) {
        status = 'failed';
        result = err.message || 'Execution failed.';
      }
      db.prepare('UPDATE approvals SET status = ?, result = ? WHERE id = ?').run(status, redact(result), a.id);
      activity.log(`approval.${status}`, `${status === 'executed' ? 'Executed' : 'Failed'}: ${a.summary}`, { id: a.id, result });
      if (status === 'failed') notifications.create({ title: 'Action failed', body: `${a.summary} — ${result}`, level: 'error', link: '#/activity' });
      return get(a.id);
    },
    reject(aid) {
      const a = get(aid);
      const res = db.prepare("UPDATE approvals SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'").run(nowIso(), a.id);
      if (res.changes !== 1) throw new ValidationError(`Approval ${a.id} is already ${a.status}.`);
      activity.log('approval.rejected', `Cancelled: ${a.summary}`, { id: a.id });
      return get(a.id);
    },
  };
}
