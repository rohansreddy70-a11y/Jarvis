// Integration registry. Each integration is an independent module that reports
// its real status. Nothing here pretends to be connected: until a module is
// implemented, configured and (if needed) authorized, it is not "connected".
//
// runtime: { google, whatsapp } live integration objects (optional).
export function integrationStatus(config, runtime = {}) {
  const { google, whatsapp } = runtime;
  const list = [
    {
      id: 'ai', name: 'AI engine', phase: 2,
      description: 'Language model used for chat and tool calling.',
      status: config.ai.configured ? 'configured' : 'not_configured',
      requires: config.ai.missing || [],
    },
    {
      id: 'email', name: 'Gmail', phase: 4,
      description: 'Read and summarize your inbox; send replies only after you approve them.',
      status: !google ? 'not_configured' : !google.configured ? 'not_configured' : google.connected ? 'configured' : 'needs_authorization',
      requires: !google ? ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] : google.configured ? (google.connected ? [] : ['Connect Gmail (Email page)']) : google.missing(),
      account: google?.connected ? google.account()?.email || null : null,
    },
    {
      id: 'calendar', name: 'Calendar (built-in)', phase: 4,
      description: 'JARVIS\'s own calendar — add events in the app or by chatting.',
      status: 'configured', requires: [],
    },
    {
      id: 'whatsapp', name: 'WhatsApp notifications', phase: 5,
      description: 'Sends your own briefings and reminders to your WhatsApp number (Meta WhatsApp Cloud API).',
      status: whatsapp?.configured ? 'configured' : 'not_configured',
      requires: whatsapp ? whatsapp.missing : ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_NOTIFY_TO'],
    },
    {
      id: 'messaging', name: 'Messaging others', phase: 5,
      description: 'Sending WhatsApp/Slack messages to other people (with approval).',
      status: 'not_implemented', requires: ['Not built yet'],
    },
    {
      id: 'research', name: 'Web research', phase: 5,
      description: 'Live web search with citations and publication dates.',
      status: 'not_implemented', requires: ['RESEARCH_API_KEY'],
    },
    {
      id: 'files', name: 'File storage', phase: 5,
      description: 'Google Drive / OneDrive / local folders.',
      status: 'not_implemented', requires: ['Provider choice'],
    },
    {
      id: 'documents', name: 'Document generation', phase: 6,
      description: 'Word, PDF, Excel and PowerPoint files, built locally (no external service).',
      status: 'configured', requires: [],
    },
    {
      id: 'notifications', name: 'In-app notifications', phase: 1,
      description: 'Notification center for reminders, approvals, briefings and failures.',
      status: 'configured', requires: [],
    },
  ];
  return list.map((i) => ({ ...i, connected: i.status === 'configured' }));
}
