// Task manager. Priorities follow the daily operating system:
// top (Top 3), important, routine, upcoming.
import { nowIso, parseFutureDate } from '../lib/time.js';
import { str, oneOf, id as vid, NotFoundError } from './validate.js';

export const PRIORITIES = ['top', 'important', 'routine', 'upcoming'];
export const STATUSES = ['pending', 'in_progress', 'done', 'cancelled'];

export function createTaskService(db, activity) {
  const get = (tid) => {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(vid(tid));
    if (!t) throw new NotFoundError(`Task ${tid} not found.`);
    return t;
  };

  return {
    PRIORITIES,
    STATUSES,
    get,
    list({ status, priority, includeClosed = false } = {}) {
      const where = [];
      const args = [];
      if (status) { where.push('status = ?'); args.push(oneOf(status, 'status', STATUSES)); }
      else if (!includeClosed) where.push("status IN ('pending','in_progress')");
      if (priority) { where.push('priority = ?'); args.push(oneOf(priority, 'priority', PRIORITIES)); }
      const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY CASE priority WHEN 'top' THEN 0 WHEN 'important' THEN 1 WHEN 'routine' THEN 2 ELSE 3 END,
                 due_at IS NULL, due_at, id`;
      return db.prepare(sql).all(...args);
    },
    create(input, actor = 'user') {
      const title = str(input.title, 'title', { required: true, max: 300 });
      const priority = oneOf(input.priority, 'priority', PRIORITIES) || 'important';
      const due = parseFutureDate(input.due_at);
      const ts = nowIso();
      const r = db.prepare(`INSERT INTO tasks (title, notes, priority, reason, project, due_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        title, str(input.notes, 'notes') || '', priority, str(input.reason, 'reason', { max: 500 }) || '',
        str(input.project, 'project', { max: 200 }) || '', due ? due.toISOString() : null, ts, ts,
      );
      const task = get(Number(r.lastInsertRowid));
      activity.log('task.created', `Task created: ${task.title}`, { id: task.id, priority, actor });
      return task;
    },
    update(tid, input, actor = 'user') {
      const existing = get(tid);
      const fields = {};
      if (input.title !== undefined) fields.title = str(input.title, 'title', { required: true, max: 300 });
      if (input.notes !== undefined) fields.notes = str(input.notes, 'notes') ?? '';
      if (input.reason !== undefined) fields.reason = str(input.reason, 'reason', { max: 500 }) ?? '';
      if (input.project !== undefined) fields.project = str(input.project, 'project', { max: 200 }) ?? '';
      if (input.priority !== undefined) fields.priority = oneOf(input.priority, 'priority', PRIORITIES, { required: true });
      if (input.status !== undefined) {
        fields.status = oneOf(input.status, 'status', STATUSES, { required: true });
        fields.completed_at = fields.status === 'done' ? nowIso() : null;
      }
      if (input.due_at !== undefined) {
        const d = parseFutureDate(input.due_at);
        fields.due_at = d ? d.toISOString() : null;
      }
      if (!Object.keys(fields).length) return existing;
      fields.updated_at = nowIso();
      const cols = Object.keys(fields);
      db.prepare(`UPDATE tasks SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...cols.map((c) => fields[c]), existing.id);
      const task = get(existing.id);
      activity.log('task.updated', `Task updated: ${task.title}`, { id: task.id, changes: Object.keys(fields), actor });
      return task;
    },
    // Hard delete. Only reachable directly by the user via the UI/API, or by the
    // assistant through an approved approval request.
    remove(tid, actor = 'user') {
      const t = get(tid);
      db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
      activity.log('task.deleted', `Task deleted: ${t.title}`, { id: t.id, actor });
      return t;
    },
    summary() {
      const open = this.list();
      const groups = Object.fromEntries(PRIORITIES.map((p) => [p, open.filter((t) => t.priority === p)]));
      const now = Date.now();
      const overdue = open.filter((t) => t.due_at && Date.parse(t.due_at) < now);
      const doneToday = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status = 'done' AND completed_at >= ?")
        .get(new Date(now - 24 * 3600 * 1000).toISOString()).c;
      return {
        open: open.length,
        overdue: overdue.length,
        doneLast24h: doneToday,
        byPriority: Object.fromEntries(PRIORITIES.map((p) => [p, groups[p].length])),
        groups,
      };
    },
  };
}
