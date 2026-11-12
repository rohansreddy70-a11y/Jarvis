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
import { createProviderFromConfig } from './ai/provider.js';
import { isConnected } from './integrations/registry.js';

export function createApp(config, { provider } = {}) {
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
  };

  // ── Approval executors: the ONLY code paths that perform sensitive actions. ──
  services.approvals.registerExecutor('task.delete', {
    execute: ({ id }) => `Deleted task "${services.tasks.remove(id, 'assistant (approved)').title}".`,
  });
  services.approvals.registerExecutor('memory.delete', {
    execute: ({ id }) => { services.memory.remove(id, 'assistant (approved)'); return 'Memory deleted.'; },
  });
  services.approvals.registerExecutor('draft.send', {
    execute: ({ draft_id }) => {
      const d = services.drafts.get(draft_id);
      const channel = d.kind === 'email' ? 'email' : 'messaging';
      if (!isConnected(config, channel)) {
        services.drafts.setStatus(d.id, 'draft');
        throw new Error(`Not sent: the ${channel} integration is not connected yet. The draft is kept.`);
      }
      // Phase 5 will dispatch to the connected integration module here.
      throw new Error(`Not sent: ${channel} sending is not implemented yet.`);
    },
  });

  const resolvedProvider = provider === undefined ? createProviderFromConfig(config) : provider;
  const toolbox = createToolbox(services, config);
  const engine = createEngine({ config, services, toolbox, getProvider: () => resolvedProvider });

  let ticker = null;
  return {
    config,
    services,
    engine,
    toolbox,
    startBackgroundJobs(intervalMs = 15_000) {
      const tick = () => {
        try { services.reminders.fireDue(); } catch (err) { activity.log('system.error', `Reminder check failed: ${err.message}`); }
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
