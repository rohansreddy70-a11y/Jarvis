// Two-way WhatsApp bot. Meta's webhook delivers messages sent to the business
// number; JARVIS answers ONLY the owner's number (WHATSAPP_NOTIFY_TO).
//
// Security:
//   • Every POST must carry a valid X-Hub-Signature-256 (HMAC-SHA256 of the raw
//     body with WHATSAPP_APP_SECRET). Unsigned or mis-signed requests are rejected.
//   • Messages from any other number are logged as "ignored" and never answered.
//   • Meta retries deliveries; message ids are de-duplicated in the database.
//   • Sensitive actions still create approvals. Approving from WhatsApp is OFF
//     unless WHATSAPP_ALLOW_APPROVALS=true, and then requires "APPROVE <id>".
import crypto from 'node:crypto';
import { nowIso } from '../lib/time.js';

const CONV_KEY = 'whatsapp.conversation_id';
const HELP = [
  '*JARVIS on WhatsApp*',
  'Just message me like you would in the app — text or voice notes. Examples:',
  '- What are my priorities today?',
  '- Remind me to call the vendor tomorrow at 10am',
  '- What\'s on my schedule tomorrow?',
  '- Draft a reply to Sam saying I\'ll send the deck Friday',
  '- Make a PowerPoint from these notes: …',
  '',
  'Commands: *new* (fresh conversation), *pending* (approvals waiting), *help*.',
].join('\n');

export function whatsappBotConfig(env) {
  return {
    appSecret: env.WHATSAPP_APP_SECRET || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
    allowApprovals: String(env.WHATSAPP_ALLOW_APPROVALS || '').toLowerCase() === 'true',
  };
}

// Markdown (as the model writes it) → WhatsApp formatting.
export function toWhatsAppText(md) {
  return String(md || '')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/__([^_\n]+)__/g, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Splits long replies into WhatsApp-sized messages on paragraph boundaries.
export function chunk(text, size = 3500) {
  const out = [];
  let cur = '';
  for (const para of text.split(/\n\n/)) {
    const piece = cur ? `${cur}\n\n${para}` : para;
    if (piece.length <= size) { cur = piece; continue; }
    if (cur) out.push(cur);
    cur = para;
    while (cur.length > size) { out.push(cur.slice(0, size)); cur = cur.slice(size); }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

export function createWhatsAppBot({ config, db, services, engine, whatsapp, transcriber }) {
  const cfg = whatsappBotConfig(config.env);
  const { activity, approvals, notifications } = services;

  const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;
  const setSetting = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  const delSetting = (k) => db.prepare('DELETE FROM settings WHERE key = ?').run(k);

  let queue = Promise.resolve(); // process messages one at a time, in order

  const status = (id, fields) => {
    const cols = Object.keys(fields);
    db.prepare(`UPDATE whatsapp_inbound SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE message_id = ?`).run(...cols.map((c) => fields[c]), id);
  };

  async function reply(text) {
    for (const part of chunk(toWhatsAppText(text))) await whatsapp.replyToOwner(part);
  }

  function approvalText(a) {
    const head = `🔐 *Approval #${a.id} needed:* ${a.summary}`;
    if (!cfg.allowApprovals) return `${head}\nOpen JARVIS → Approvals to confirm or cancel. Nothing happens until you do.`;
    const content = a.content ? `\n\n${a.content.slice(0, 600)}${a.content.length > 600 ? '…' : ''}` : '';
    return `${head}\nTarget: ${a.target || '—'}${content}\n\nReply *APPROVE ${a.id}* to do it, or *CANCEL ${a.id}*.`;
  }

  // Bot commands handled without the AI.
  async function command(text) {
    const t = text.trim();
    if (/^\/?(help|menu|\?)$/i.test(t)) return HELP;
    if (/^\/?(new|reset|new chat)$/i.test(t)) { delSetting(CONV_KEY); return 'Started a fresh conversation. 👍'; }
    if (/^\/?pending$/i.test(t)) {
      const list = approvals.list({ status: 'pending' });
      return list.length ? list.map(approvalText).join('\n\n') : 'Nothing is waiting for approval.';
    }
    const m = t.match(/^(approve|confirm|cancel|reject)\s+#?(\d+)$/i);
    if (m) {
      const id = Number(m[2]);
      const approve = /^(approve|confirm)$/i.test(m[1]);
      if (approve && !cfg.allowApprovals) return 'Approving from WhatsApp is turned off. Open JARVIS → Approvals to confirm. (You can enable it with WHATSAPP_ALLOW_APPROVALS=true.)';
      try {
        if (approve) {
          const r = await approvals.confirm(id);
          return r.status === 'executed' ? `✅ Done: ${r.result}` : `❌ Failed: ${r.result}`;
        }
        approvals.reject(id);
        return `Cancelled approval #${id}. Nothing was done.`;
      } catch (err) {
        return `Couldn't do that: ${err.message}`;
      }
    }
    return null;
  }

  async function processMessage(msg) {
    const id = msg.id;
    try {
      let text = '';
      if (msg.type === 'text') text = String(msg.text?.body || '').slice(0, 4000);
      else if (msg.type === 'audio') {
        if (!transcriber) throw new Error('Voice notes need AI_PROVIDER=groq or openai (for speech-to-text). Please type your message instead.');
        const media = await whatsapp.downloadMedia(msg.audio?.id);
        text = (await transcriber.transcribe(media.buffer, { mime: media.mime, filename: 'voice.ogg' })).slice(0, 4000);
        status(id, { text });
        if (!text) throw new Error("I couldn't make out that voice note. Could you try again or type it?");
      } else if (msg.type === 'interactive' || msg.type === 'button') {
        text = msg.button?.text || msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
      } else {
        await reply('I can read text messages and voice notes. Files, images and stickers aren\'t supported yet.');
        status(id, { status: 'processed', reply: '(unsupported type)', processed_at: nowIso() });
        return;
      }

      const direct = await command(text);
      let out;
      if (direct !== null) out = direct;
      else {
        const convId = Number(getSetting(CONV_KEY)) || null;
        let res;
        try {
          res = await engine.chat({ conversationId: convId, message: msg.type === 'audio' ? `(voice note) ${text}` : text, channel: 'whatsapp' });
        } catch (err) {
          if (err.status === 404 && convId) { // conversation was deleted in the app
            delSetting(CONV_KEY);
            res = await engine.chat({ conversationId: null, message: text, channel: 'whatsapp' });
          } else throw err;
        }
        setSetting(CONV_KEY, res.conversationId);
        const pending = res.actions.filter((a) => a.approvalId).map((a) => approvals.get(a.approvalId));
        out = [msg.type === 'audio' ? `🎙️ _"${text.slice(0, 200)}"_` : '', res.reply, ...pending.map(approvalText)].filter(Boolean).join('\n\n');
      }
      await reply(out);
      status(id, { status: 'processed', reply: out.slice(0, 4000), processed_at: nowIso() });
      activity.log('whatsapp.reply', 'Replied on WhatsApp', { message_id: id, type: msg.type });
    } catch (err) {
      status(id, { status: 'failed', error: err.message.slice(0, 500), processed_at: nowIso() });
      activity.log('whatsapp.error', `WhatsApp message failed: ${err.message}`, { message_id: id });
      try { await reply(`⚠️ ${err.message}`); } catch { notifications.create({ title: 'WhatsApp bot error', body: err.message, level: 'error', link: '#/settings' }); }
    }
  }

  return {
    get configured() { return Boolean(whatsapp.configured && cfg.appSecret && cfg.verifyToken); },
    missing: () => [
      ...(whatsapp.configured ? [] : whatsapp.missing),
      !cfg.appSecret && 'WHATSAPP_APP_SECRET',
      !cfg.verifyToken && 'WHATSAPP_VERIFY_TOKEN',
    ].filter(Boolean),
    allowApprovals: cfg.allowApprovals,

    // GET handshake when you register the webhook in the Meta dashboard.
    verifySubscription(query) {
      const ok = cfg.verifyToken && query.get('hub.mode') === 'subscribe'
        && safeEqual(query.get('hub.verify_token') || '', cfg.verifyToken);
      if (!ok) return null;
      activity.log('whatsapp.webhook', 'WhatsApp webhook verified by Meta');
      return String(query.get('hub.challenge') || '');
    },

    verifySignature(rawBody, header) {
      if (!cfg.appSecret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
      const expected = `sha256=${crypto.createHmac('sha256', cfg.appSecret).update(rawBody).digest('hex')}`;
      return safeEqual(header, expected);
    },

    // Accepts a verified webhook payload. Returns promises for the messages it
    // will process (the HTTP layer responds to Meta before awaiting them).
    accept(payload) {
      const jobs = [];
      for (const entry of payload?.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          for (const msg of value.messages || []) {
            if (!msg?.id || !msg.from) continue;
            const from = String(msg.from).replace(/\D/g, '');
            const ins = db.prepare('INSERT OR IGNORE INTO whatsapp_inbound (message_id, from_number, type, text, received_at) VALUES (?, ?, ?, ?, ?)')
              .run(String(msg.id), from, String(msg.type || 'unknown'), msg.type === 'text' ? String(msg.text?.body || '').slice(0, 4000) : '', nowIso());
            if (ins.changes !== 1) continue; // duplicate delivery
            if (!whatsapp.ownerNumber || from !== whatsapp.ownerNumber) {
              status(String(msg.id), { status: 'ignored', text: '', processed_at: nowIso() }); // don't keep strangers' text
              activity.log('whatsapp.ignored', 'Ignored a WhatsApp message from a number that is not yours');
              continue;
            }
            queue = queue.then(() => processMessage(msg));
            jobs.push(queue);
          }
        }
      }
      return jobs;
    },

    recent(limit = 20) {
      return db.prepare("SELECT message_id, type, text, status, reply, error, received_at FROM whatsapp_inbound WHERE status != 'ignored' ORDER BY received_at DESC LIMIT ?").all(limit);
    },
  };
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
