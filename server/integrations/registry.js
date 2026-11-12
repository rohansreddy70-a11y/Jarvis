// Integration registry. Each integration is an independent module that reports
// its real status. Nothing here pretends to be connected: until a module is
// implemented AND configured, its status is "not_implemented" or "not_configured".
const INTEGRATIONS = [
  {
    id: 'ai',
    name: 'AI engine',
    description: 'Language model used for chat and tool calling.',
    phase: 2,
    implemented: true,
    status: (cfg) => (cfg.ai.configured ? 'configured' : 'not_configured'),
    requires: (cfg) => cfg.ai.missing || [],
  },
  {
    id: 'email',
    name: 'Email',
    description: 'Read, summarize and (with approval) send email — Gmail or Microsoft 365 via OAuth.',
    phase: 5,
    implemented: false,
    requires: () => ['EMAIL_PROVIDER', 'OAuth client credentials'],
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Today\'s meetings, conflicts and prep notes — Google Calendar or Outlook.',
    phase: 5,
    implemented: false,
    requires: () => ['CALENDAR_PROVIDER', 'OAuth client credentials'],
  },
  {
    id: 'messaging',
    name: 'Messaging',
    description: 'Slack / Teams message summaries and approved replies.',
    phase: 5,
    implemented: false,
    requires: () => ['Provider choice', 'Bot / app token'],
  },
  {
    id: 'research',
    name: 'Web research',
    description: 'Live web search with citations and publication dates.',
    phase: 5,
    implemented: false,
    requires: () => ['RESEARCH_API_KEY'],
  },
  {
    id: 'files',
    name: 'File storage',
    description: 'Google Drive / OneDrive / local folders.',
    phase: 5,
    implemented: false,
    requires: () => ['Provider choice', 'OAuth client credentials'],
  },
  {
    id: 'documents',
    name: 'Document generation',
    description: 'Word, PDF, Excel and PowerPoint output.',
    phase: 6,
    implemented: false,
    requires: () => [],
  },
  {
    id: 'notifications',
    name: 'Notifications',
    description: 'In-app notification center (reminders, approvals, failures). Push/email delivery later.',
    phase: 1,
    implemented: true,
    status: () => 'configured',
    requires: () => [],
  },
];

export function integrationStatus(config) {
  return INTEGRATIONS.map((i) => {
    const status = i.implemented ? i.status(config) : 'not_implemented';
    return {
      id: i.id,
      name: i.name,
      description: i.description,
      phase: i.phase,
      status,
      connected: status === 'configured',
      requires: status === 'configured' ? [] : i.requires(config),
    };
  });
}

export function isConnected(config, id) {
  return integrationStatus(config).find((i) => i.id === id)?.connected === true;
}
