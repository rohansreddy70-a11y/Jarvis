// WhatsApp notifications via Meta's WhatsApp Cloud API.
// Deliberately narrow: it can only message the owner's own number
// (WHATSAPP_NOTIFY_TO). It has no way to message anyone else.
//
// WhatsApp rule: a business number may send free-form text only within 24h of
// the recipient's last message to it. Outside that window an approved message
// template is required — set WHATSAPP_TEMPLATE_NAME (template with one body
// variable {{1}}) for reliable nightly delivery.
const GRAPH = 'https://graph.facebook.com/v21.0';

export function whatsappConfig(env) {
  const c = {
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    to: (env.WHATSAPP_NOTIFY_TO || '').replace(/[^\d]/g, ''),
    template: env.WHATSAPP_TEMPLATE_NAME || '',
    templateLang: env.WHATSAPP_TEMPLATE_LANG || 'en',
  };
  c.missing = [
    !c.token && 'WHATSAPP_TOKEN',
    !c.phoneNumberId && 'WHATSAPP_PHONE_NUMBER_ID',
    !c.to && 'WHATSAPP_NOTIFY_TO',
  ].filter(Boolean);
  if (c.to && (c.to.length < 10 || c.to.length > 15)) c.missing.push('WHATSAPP_NOTIFY_TO (use country code, e.g. 91XXXXXXXXXX)');
  c.configured = c.missing.length === 0;
  return c;
}

// Template variables may not contain newlines, tabs or 4+ spaces, max 1024 chars.
export function templateSafe(text) {
  return text.replace(/\s*\n+\s*/g, ' | ').replace(/\t/g, ' ').replace(/ {4,}/g, '   ').slice(0, 1000);
}

export function createWhatsApp(env, { fetchImpl = fetch } = {}) {
  const cfg = whatsappConfig(env);
  const textBody = (text) => ({ messaging_product: 'whatsapp', to: cfg.to, type: 'text', text: { preview_url: false, body: String(text).slice(0, 4000) } });
  async function post(body) {
    let res;
    try {
      res = await fetchImpl(`${GRAPH}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error('WhatsApp API could not be reached.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message ? String(data.error.message).slice(0, 200) : `HTTP ${res.status}`;
      const hint = /re-engagement|24 hours|131047/.test(JSON.stringify(data)) ? ' (outside the 24-hour window — configure WHATSAPP_TEMPLATE_NAME)' : '';
      throw new Error(`WhatsApp rejected the message: ${msg}${hint}`);
    }
    const id = data?.messages?.[0]?.id;
    if (!id) throw new Error('WhatsApp did not confirm the message.');
    return id;
  }
  return {
    ownerNumber: cfg.to,
    get configured() { return cfg.configured; },
    get missing() { return cfg.missing; },
    usesTemplate: () => Boolean(cfg.template),
    // Briefings/notifications: uses the approved template when configured, so
    // they arrive even outside WhatsApp's 24-hour reply window.
    async notifyOwner(text) {
      if (!cfg.configured) throw new Error(`WhatsApp is not configured (missing ${cfg.missing.join(', ')}).`);
      return post(cfg.template
        ? {
          messaging_product: 'whatsapp', to: cfg.to, type: 'template',
          template: { name: cfg.template, language: { code: cfg.templateLang }, components: [{ type: 'body', parameters: [{ type: 'text', text: templateSafe(text) }] }] },
        }
        : textBody(text));
    },
    // Bot replies: free-form text, valid because the owner just messaged us.
    async replyToOwner(text) {
      if (!cfg.configured) throw new Error(`WhatsApp is not configured (missing ${cfg.missing.join(', ')}).`);
      return post(textBody(text));
    },
    // Downloads an inbound media file (e.g. a voice note) by its media id.
    async downloadMedia(mediaId) {
      if (!/^[\w.-]{1,128}$/.test(String(mediaId))) throw new Error('Invalid media id.');
      const auth = { Authorization: `Bearer ${cfg.token}` };
      const meta = await fetchImpl(`${GRAPH}/${mediaId}`, { headers: auth, signal: AbortSignal.timeout(20_000) });
      const info = await meta.json().catch(() => ({}));
      if (!meta.ok || !info.url) throw new Error('Could not get the voice note from WhatsApp.');
      if (Number(info.file_size) > 16 * 1024 * 1024) throw new Error('Voice note is too large.');
      // Only send the token to Meta's own media hosts.
      const host = (() => { try { const u = new URL(info.url); return u.protocol === 'https:' ? u.hostname : ''; } catch { return ''; } })();
      if (!/(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net|fbcdn\.net)$/.test(host)) throw new Error('Unexpected media host from WhatsApp.');
      const file = await fetchImpl(info.url, { headers: auth, signal: AbortSignal.timeout(30_000) });
      if (!file.ok) throw new Error('Could not download the voice note.');
      return { buffer: Buffer.from(await file.arrayBuffer()), mime: info.mime_type || 'audio/ogg' };
    },
  };
}
