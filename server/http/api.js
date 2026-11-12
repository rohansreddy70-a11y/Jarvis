// REST API. All routes are under /api and require the access token when one is configured.
import { createRouter, HttpError } from './router.js';
import { publicStatus } from '../config.js';
import { integrationStatus } from '../integrations/registry.js';
import { str } from '../services/validate.js';

export function createApi(app) {
  const { config, services: s, engine } = app;
  const r = createRouter();
  const user = 'user';

  // ── System ──
  r.get('/api/health', () => ({ ok: true }));
  r.get('/api/status', () => ({
    ...publicStatus(config),
    integrations: integrationStatus(config),
    counts: {
      pendingApprovals: s.approvals.pendingCount(),
      unreadNotifications: s.notifications.unreadCount(),
    },
  }));
  r.get('/api/dashboard', () => {
    const summary = s.tasks.summary();
    return {
      status: publicStatus(config),
      tasks: summary,
      reminders: s.reminders.list().slice(0, 8),
      drafts: s.drafts.list().slice(0, 5),
      approvals: s.approvals.list({ status: 'pending' }),
      integrations: integrationStatus(config),
      activity: s.activity.list({ limit: 8 }),
      memoryCount: s.memory.list({ limit: 500 }).length,
    };
  });

  // ── Chat ──
  r.post('/api/chat', async ({ body }) => {
    const message = str(body.message, 'message', { required: true, max: 8000 });
    return engine.chat({ conversationId: body.conversationId || null, message });
  });
  r.get('/api/conversations', () => s.conversations.list());
  r.get('/api/conversations/:id', ({ params }) => ({ ...s.conversations.get(params.id), messages: s.conversations.transcript(params.id) }));
  r.delete('/api/conversations/:id', ({ params }) => {
    s.conversations.get(params.id);
    s.conversations.remove(params.id);
    s.activity.log('conversation.deleted', 'Conversation deleted', { id: Number(params.id), actor: user });
    return { ok: true };
  });

  // ── Tasks ──
  r.get('/api/tasks', ({ query }) => s.tasks.list({
    status: query.get('status') || undefined, priority: query.get('priority') || undefined, includeClosed: query.get('all') === '1',
  }));
  r.post('/api/tasks', ({ body }) => s.tasks.create(body, user));
  r.patch('/api/tasks/:id', ({ params, body }) => s.tasks.update(params.id, body, user));
  r.delete('/api/tasks/:id', ({ params }) => s.tasks.remove(params.id, user)); // user-initiated, UI confirms first

  // ── Reminders ──
  r.get('/api/reminders', ({ query }) => s.reminders.list({ includeDone: query.get('all') === '1' }));
  r.post('/api/reminders', ({ body }) => s.reminders.create(body, user));
  r.patch('/api/reminders/:id', ({ params, body }) => s.reminders.update(params.id, body, user));
  r.post('/api/reminders/:id/cancel', ({ params }) => s.reminders.cancel(params.id, user));

  // ── Memory ──
  r.get('/api/memory', ({ query }) => s.memory.list({ query: query.get('q') || undefined, category: query.get('category') || undefined }));
  r.post('/api/memory', ({ body }) => s.memory.create(body, user));
  r.patch('/api/memory/:id', ({ params, body }) => s.memory.update(params.id, body, user));
  r.delete('/api/memory/:id', ({ params }) => s.memory.remove(params.id, user));

  // ── Drafts ──
  r.get('/api/drafts', ({ query }) => s.drafts.list({ includeClosed: query.get('all') === '1' }));
  r.post('/api/drafts', ({ body }) => s.drafts.create(body, user));
  r.patch('/api/drafts/:id', ({ params, body }) => s.drafts.update(params.id, body, user));
  r.post('/api/drafts/:id/discard', ({ params }) => s.drafts.discard(params.id, user));
  r.post('/api/drafts/:id/request-send', ({ params }) => {
    const d = s.drafts.get(params.id);
    const ap = s.approvals.request({
      actionType: 'draft.send', target: d.recipient || '(no recipient)', summary: `Send ${d.kind.replace('_', ' ')}${d.subject ? ` "${d.subject}"` : ''}`,
      content: d.body, payload: { draft_id: d.id },
    }, user);
    s.drafts.setStatus(d.id, 'pending_approval');
    return ap;
  });

  // ── Approvals ──
  r.get('/api/approvals', ({ query }) => s.approvals.list({ status: query.get('status') || undefined }));
  r.get('/api/approvals/:id', ({ params }) => s.approvals.get(params.id));
  r.post('/api/approvals/:id/confirm', ({ params }) => s.approvals.confirm(params.id));
  r.post('/api/approvals/:id/reject', ({ params }) => {
    const a = s.approvals.reject(params.id);
    if (a.action_type === 'draft.send') s.drafts.setStatus(a.payload.draft_id, 'draft');
    return a;
  });

  // ── Notifications & activity ──
  r.get('/api/notifications', () => s.notifications.list());
  r.post('/api/notifications/read-all', () => { s.notifications.markAllRead(); return { ok: true }; });
  r.post('/api/notifications/:id/read', ({ params }) => { s.notifications.markRead(params.id); return { ok: true }; });
  r.get('/api/activity', ({ query }) => s.activity.list({ limit: query.get('limit'), type: query.get('type') || undefined }));

  r.get('/api/integrations', () => integrationStatus(config));

  return r;
}

export { HttpError };
