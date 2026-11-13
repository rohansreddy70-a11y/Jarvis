// REST API. All routes are under /api and require the access token when one is configured.
import { createRouter, HttpError } from './router.js';
import { publicStatus } from '../config.js';
import { str } from '../services/validate.js';

export function createApi(app) {
  const { config, services: s, engine } = app;
  const r = createRouter();
  const integrationStatus = () => s.integrations.status();
  const { google, whatsapp } = s.integrations;
  const user = 'user';

  // ── System ──
  r.get('/api/health', () => ({ ok: true }));
  r.get('/api/status', () => ({
    ...publicStatus(config),
    integrations: integrationStatus(),
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
      integrations: integrationStatus(),
      activity: s.activity.list({ limit: 8 }),
      memoryCount: s.memory.list({ limit: 500 }).length,
      today: s.schedule.forDay('today'),
      tomorrow: s.schedule.forDay('tomorrow'),
    };
  });

  // ── Chat ──
  r.post('/api/chat', async ({ body }) => {
    const message = str(body.message, 'message', { required: true, max: 8000 });
    const channel = body.channel === 'voice' ? 'voice' : 'web';
    return engine.chat({ conversationId: body.conversationId || null, message, channel });
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
  r.post('/api/approvals/:id/reject', ({ params }) => s.approvals.reject(params.id));

  // ── Notifications & activity ──
  r.get('/api/notifications', () => s.notifications.list());
  r.post('/api/notifications/read-all', () => { s.notifications.markAllRead(); return { ok: true }; });
  r.post('/api/notifications/:id/read', ({ params }) => { s.notifications.markRead(params.id); return { ok: true }; });
  r.get('/api/activity', ({ query }) => s.activity.list({ limit: query.get('limit'), type: query.get('type') || undefined }));

  r.get('/api/integrations', () => integrationStatus());

  // ── Calendar (built-in) ──
  r.get('/api/schedule', ({ query }) => s.schedule.forDay(query.get('day') || 'today'));
  r.get('/api/events', ({ query }) => {
    const from = query.get('from') ? new Date(query.get('from')) : new Date(Date.now() - 86400e3);
    const to = query.get('to') ? new Date(query.get('to')) : new Date(from.getTime() + 31 * 86400e3);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new HttpError(400, 'from/to must be ISO dates.');
    return s.events.between(from, to);
  });
  r.post('/api/events', ({ body }) => s.events.create(body, user));
  r.patch('/api/events/:id', ({ params, body }) => s.events.update(params.id, body, user));
  r.delete('/api/events/:id', ({ params }) => s.events.remove(params.id, user));

  // ── Automations ──
  r.get('/api/automations', () => s.automations.list());
  r.patch('/api/automations/:id', ({ params, body }) => s.automations.update(params.id, body));
  r.get('/api/automations/:id/runs', ({ params }) => s.automations.runs(params.id));
  r.get('/api/automations/:id/preview', async ({ params }) => ({ text: await s.automations.preview(params.id) }));
  r.post('/api/automations/:id/run', async ({ params }) => s.automations.runNow(params.id));

  // ── Reports ──
  r.get('/api/reports', ({ query }) => s.reports.list({ type: query.get('type') || undefined }));
  r.get('/api/reports/:id', ({ params }) => s.reports.get(params.id));
  r.post('/api/reports/generate', async ({ body }) => s.reports.generate(body.type, { actor: user }));

  // ── Documents ──
  r.get('/api/documents', () => s.documents.list());
  r.post('/api/documents', ({ body }) => s.documents.create(body, user));
  r.post('/api/reports/:id/export', ({ params, body }) => s.documents.createFromReport(s.reports.get(params.id), body.format, user));
  r.get('/api/documents/:id/download', ({ params }) => {
    const { doc, buffer, mime } = s.documents.read(params.id);
    return { __file: { buffer, mime, filename: doc.filename.replace(/^\d+-/, '') } };
  });
  r.delete('/api/documents/:id', ({ params }) => s.documents.remove(params.id, user)); // user-initiated, UI confirms first

  // ── Gmail ──
  r.get('/api/integrations/google/auth-url', () => ({ url: google.authUrl(), redirectUri: google.redirectUri }));
  // Browser redirect from Google: exempt from bearer auth, protected by one-time state.
  r.get('/api/integrations/google/callback', async ({ query }) => {
    try {
      const acct = await google.handleCallback({ code: query.get('code'), state: query.get('state'), error: query.get('error') });
      s.activity.log('integration.connected', `Gmail connected${acct?.email ? ' (' + acct.email + ')' : ''}`, { actor: user });
      return { __redirect: '/#/email?connected=1' };
    } catch (err) {
      s.activity.log('integration.error', `Gmail connection failed: ${err.message}`);
      return { __redirect: `/#/email?error=${encodeURIComponent(err.message)}` };
    }
  });
  r.post('/api/integrations/google/disconnect', async () => {
    await google.disconnect();
    s.activity.log('integration.disconnected', 'Gmail disconnected', { actor: user });
    return { ok: true };
  });
  r.get('/api/email/messages', async ({ query }) => {
    if (!google.connected) throw new HttpError(409, 'Gmail is not connected.');
    return google.listMessages({ query: query.get('q') || 'in:inbox', max: query.get('max') || 20 });
  });
  r.get('/api/email/messages/:id', async ({ params }) => {
    if (!google.connected) throw new HttpError(409, 'Gmail is not connected.');
    return google.getMessage(params.id);
  });

  // ── WhatsApp bot ──
  r.get('/api/integrations/whatsapp/bot', () => ({
    configured: s.whatsappBot.configured,
    missing: s.whatsappBot.missing(),
    allowApprovals: s.whatsappBot.allowApprovals,
    webhookPath: '/api/integrations/whatsapp/webhook',
    recent: s.whatsappBot.recent(),
  }));

  // ── WhatsApp ──
  r.post('/api/integrations/whatsapp/test', async () => {
    const id = await whatsapp.notifyOwner('✅ JARVIS test message. WhatsApp notifications are working.').catch((err) => { throw new HttpError(502, err.message); });
    s.activity.log('whatsapp.test', 'WhatsApp test message sent to owner', { id });
    return { ok: true, id };
  });

  return r;
}

export { HttpError };
