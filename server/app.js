// Composition root: wires storage, services, approval executors and the AI engine.
import { openDatabase } from './db.js';
import { createActivityService } from './services/activity.js';
import { createNotificationService } from './services/notifications.js';
import { createTaskService } from './services/tasks.js';
import { createReminderService } from './services/reminders.js';
import { createMemoryService } from './services/memory.js';
import { createDraftService } from './services/drafts.js';
import { createApprovalService } from './services/approvals.js';
import { createConversationService } from './services/conversations.js';
import { createToolbox } from './ai/tools.js';
import { createEngine } from './ai/engine.js';
import { createProviderFromConfig, createTranscriber } from './ai/provider.js';
import { createWhatsAppBot } from './integrations/whatsapp-bot.js';
import { integrationStatus } from './integrations/registry.js';
import { createEventService } from './services/events.js';
import { createScheduleService } from './services/schedule.js';
import { createGoogle } from './integrations/google.js';
import { createWhatsApp } from './integrations/whatsapp.js';
import { createAutomationEngine } from './automations/engine.js';
import { createReportService } from './services/reports.js';
import { createDocumentService } from './services/documents.js';

export function createApp(config, { provider, fetchImpl } = {}) {
  const db = openDatabase(config.dbPath);
  const activity = createActivityService(db);
  const notifications = createNotificationService(db);
  const services = {
    db,
    activity,
    notifications,
    tasks: createTaskService(db, activity),
    reminders: createReminderService(db, activity, notifications),
    memory: createMemoryService(db, activity),
    drafts: createDraftService(db, activity),
    approvals: createApprovalService(db, activity, notifications),
    conversations: createConversationService(db),
    events: createEventService(db, activity),
    documents: createDocumentService(db, activity, config),
  };
  services.schedule = createScheduleService(services, config);

  // ── Integrations (independent modules) ──
  const net = fetchImpl ? { fetchImpl } : {};
  const google = createGoogle(config, db, net);
  const whatsapp = createWhatsApp(config.env, net);
  const runtime = { google, whatsapp };
  const status = () => integrationStatus(config, runtime);
  services.integrations = { google, whatsapp, status };
  services.reports = createReportService(services, config);
  services.automations = createAutomationEngine({ db, config, services, whatsapp });

  // ── Approval executors: the ONLY code paths that perform sensitive actions. ──
  services.approvals.registerExecutor('task.delete', {
    execute: ({ id }) => `Deleted task "${services.tasks.remove(id, 'assistant (approved)').title}".`,
  });
  services.approvals.registerExecutor('memory.delete', {
    execute: ({ id }) => { services.memory.remove(id, 'assistant (approved)'); return 'Memory deleted.'; },
  });
  services.approvals.registerExecutor('event.delete', {
    execute: ({ id }) => `Deleted event "${services.events.remove(id, 'assistant (approved)').title}".`,
  });
  services.approvals.registerExecutor('document.delete', {
    execute: ({ id }) => `Deleted document "${services.documents.remove(id, 'assistant (approved)').title}".`,
  });
  services.approvals.registerExecutor('draft.send', {
    onReject: ({ draft_id }) => services.drafts.setStatus(draft_id, 'draft'),
    execute: async ({ draft_id }) => {
      const d = services.drafts.get(draft_id);
      if (d.status === 'sent') throw new Error('This draft was already sent.');
      if (d.kind !== 'email') {
        services.drafts.setStatus(d.id, 'draft');
        throw new Error('Not sent: sending messages to other people is not implemented yet. The draft is kept.');
      }
      if (!google.connected) {
        services.drafts.setStatus(d.id, 'draft');
        throw new Error('Not sent: Gmail is not connected. The draft is kept.');
      }
      try {
        const id = await google.send({ to: d.recipient, subject: d.subject, body: d.body });
        services.drafts.setStatus(d.id, 'sent');
        return `Email sent to ${d.recipient} (Gmail message id ${id}).`;
      } catch (err) {
        services.drafts.setStatus(d.id, 'draft');
        throw new Error(`Not sent: ${err.message} The draft is kept.`);
      }
    },
  });

  const resolvedProvider = provider === undefined ? createProviderFromConfig(config) : provider;
  const toolbox = createToolbox(services, config);
  const engine = createEngine({ config, services, toolbox, getProvider: () => resolvedProvider });
  const transcriber = createTranscriber(config, net);
  services.whatsappBot = createWhatsAppBot({ config, db, services, engine, whatsapp, transcriber });
  runtime.whatsappBot = services.whatsappBot;

  let ticker = null;
  return {
    config,
    services,
    engine,
    toolbox,
    startBackgroundJobs(intervalMs = 15_000) {
      const tick = () => {
        try { services.reminders.fireDue(); } catch (err) { activity.log('system.error', `Reminder check failed: ${err.message}`); }
        services.automations.tick().catch((err) => activity.log('system.error', `Automation check failed: ${err.message}`));
      };
      tick();
      ticker = setInterval(tick, intervalMs);
      ticker.unref?.();
    },
    close() {
      if (ticker) clearInterval(ticker);
      db.close();
    },
  };
}
