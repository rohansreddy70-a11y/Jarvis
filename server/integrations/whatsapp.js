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
  return {
    get configured() { return cfg.configured; },
    get missing() { return cfg.missing; },
    usesTemplate: () => Boolean(cfg.template),
    // Returns the WhatsApp message id. Throws with a readable error on failure.
    async notifyOwner(text) {
      if (!cfg.configured) throw new Error(`WhatsApp is not configured (missing ${cfg.missing.join(', ')}).`);
      const body = cfg.template
        ? {
          messaging_product: 'whatsapp', to: cfg.to, type: 'template',
          template: { name: cfg.template, language: { code: cfg.templateLang }, components: [{ type: 'body', parameters: [{ type: 'text', text: templateSafe(text) }] }] },
        }
        : { messaging_product: 'whatsapp', to: cfg.to, type: 'text', text: { preview_url: false, body: text.slice(0, 4000) } };
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
    },
  };
}
