// Google (Gmail) integration via OAuth 2.0.
// Scopes are least-privilege for what JARVIS does: read mail, and send mail
// (sending is only ever triggered by an approved approval request).
// The refresh token is stored in the local SQLite database (data/ is git-ignored)
// and never sent to the browser or logged.
import crypto from 'node:crypto';
import { nowIso } from '../lib/time.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];
const TOKEN_KEY = 'google.oauth';

export function createGoogle(config, db, { fetchImpl = fetch } = {}) {
  const env = config.env;
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = env.GOOGLE_REDIRECT_URI || `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}/api/integrations/google/callback`;
  const pendingStates = new Map(); // state -> expiry ms
  let cachedAccess = null; // { token, expires }

  const readTokens = () => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(TOKEN_KEY);
    return row ? JSON.parse(row.value) : null;
  };
  const writeTokens = (v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(TOKEN_KEY, JSON.stringify(v));

  async function call(url, init = {}, label = 'Google') {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw gErr(502, `${label} could not be reached.`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error_description || data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || `HTTP ${res.status}`;
      const err = gErr(502, `${label} error: ${String(msg).slice(0, 200)}`);
      err.httpStatus = res.status;
      throw err;
    }
    return data;
  }

  async function accessToken() {
    if (cachedAccess && cachedAccess.expires > Date.now() + 60_000) return cachedAccess.token;
    const t = readTokens();
    if (!t?.refresh_token) throw gErr(502, 'Gmail is not connected. Connect it from the Email page.');
    try {
      const data = await call(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }),
      }, 'Google sign-in');
      cachedAccess = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
      return cachedAccess.token;
    } catch (err) {
      if (/invalid_grant/.test(err.message)) throw gErr(502, 'Gmail access was revoked or expired. Reconnect Gmail from the Email page.');
      throw err;
    }
  }

  const gmail = async (path, init = {}) => call(`${GMAIL}${path}`, {
    ...init, headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.headers || {}) },
  }, 'Gmail');

  const header = (msg, name) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  function summarize(m) {
    return {
      id: m.id,
      threadId: m.threadId,
      from: header(m, 'From'),
      to: header(m, 'To'),
      subject: header(m, 'Subject') || '(no subject)',
      date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : header(m, 'Date'),
      snippet: decodeEntities(m.snippet || ''),
      unread: (m.labelIds || []).includes('UNREAD'),
      important: (m.labelIds || []).includes('IMPORTANT'),
    };
  }

  return {
    get configured() { return Boolean(clientId && clientSecret); },
    missing: () => [!clientId && 'GOOGLE_CLIENT_ID', !clientSecret && 'GOOGLE_CLIENT_SECRET'].filter(Boolean),
    get connected() { return this.configured && Boolean(readTokens()?.refresh_token); },
    account: () => { const t = readTokens(); return t ? { email: t.email || null, connected_at: t.connected_at, scopes: t.scope } : null; },
    redirectUri,

    authUrl() {
      if (!this.configured) throw gErr(400, 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
      const state = crypto.randomBytes(24).toString('hex');
      const now = Date.now();
      for (const [k, exp] of pendingStates) if (exp < now) pendingStates.delete(k);
      pendingStates.set(state, now + 10 * 60_000);
      return `${AUTH_URL}?${new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_SCOPES.join(' '),
        access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
      })}`;
    },

    // One-time, expiring state prevents forged callbacks (CSRF).
    async handleCallback({ code, state, error }) {
      const exp = pendingStates.get(state);
      pendingStates.delete(state);
      if (!state || !exp || exp < Date.now()) throw gErr(502, 'Sign-in link expired or invalid. Start again from the Email page.');
      if (error) throw gErr(502, `Google sign-in was cancelled (${error}).`);
      if (!code) throw gErr(502, 'Google did not return an authorization code.');
      const data = await call(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      }, 'Google sign-in');
      if (!data.refresh_token) throw gErr(502, 'Google did not return a refresh token. Remove JARVIS from your Google account permissions and connect again.');
      cachedAccess = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
      writeTokens({ refresh_token: data.refresh_token, scope: data.scope, connected_at: nowIso() });
      try {
        const profile = await gmail('/profile');
        writeTokens({ ...readTokens(), email: profile.emailAddress });
      } catch { /* profile is cosmetic */ }
      return this.account();
    },

    async disconnect() {
      const t = readTokens();
      db.prepare('DELETE FROM settings WHERE key = ?').run(TOKEN_KEY);
      cachedAccess = null;
      if (t?.refresh_token) {
        try { await call(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refresh_token }) }, 'Google'); } catch { /* local removal is what matters */ }
      }
    },

    async listMessages({ query = 'in:inbox', max = 15 } = {}) {
      const n = Math.min(Math.max(Number(max) || 15, 1), 30);
      const list = await gmail(`/messages?${new URLSearchParams({ q: String(query).slice(0, 300), maxResults: String(n) })}`);
      const ids = (list.messages || []).map((m) => m.id);
      const metaQs = 'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date';
      const msgs = await Promise.all(ids.map((id) => gmail(`/messages/${encodeURIComponent(id)}?${metaQs}`)));
      return msgs.map(summarize);
    },

    async getMessage(id) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw gErr(400, 'Invalid message id.');
      const m = await gmail(`/messages/${id}?format=full`);
      return { ...summarize(m), body: extractBody(m.payload).slice(0, 15000) };
    },

    async send({ to, subject, body }) {
      for (const [k, v] of Object.entries({ to, subject })) {
        if (/[\r\n]/.test(v || '')) throw gErr(400, `Invalid ${k}: line breaks are not allowed.`);
      }
      const recipients = String(to || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!recipients.length || !recipients.every((r) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(r.replace(/^.*<(.+)>$/, '$1')))) {
        throw gErr(400, `Invalid recipient "${to}".`);
      }
      const mime = [
        `To: ${recipients.join(', ')}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject || '').toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(body || '').toString('base64'),
      ].join('\r\n');
      const sent = await gmail('/messages/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: Buffer.from(mime).toString('base64url') }),
      });
      if (!sent?.id) throw gErr(502, 'Gmail did not confirm the message was sent.');
      return sent.id;
    },
  };
}

function gErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function decodeEntities(s) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function extractBody(payload) {
  if (!payload) return '';
  const parts = [];
  const walk = (p) => { parts.push(p); (p.parts || []).forEach(walk); };
  walk(payload);
  const dec = (p) => Buffer.from(p.body?.data || '', 'base64url').toString('utf8');
  const plain = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  if (plain) return dec(plain);
  const html = parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  if (html) {
    return decodeEntities(dec(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ''))
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  return '';
}
