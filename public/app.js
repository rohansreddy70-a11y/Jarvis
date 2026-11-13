// JARVIS dashboard — vanilla ES modules, no build step.
// All dynamic text is inserted via textContent (see h()), so API data can't inject HTML.

// ───────────────────────── helpers ─────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // only used with locally-escaped markup
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
function icon(name, cls) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  if (cls) svg.setAttribute('class', cls);
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
const fill = (root, ...kids) => root.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Minimal, safe markdown: escape first, then format.
function md(text) {
  const lines = esc(text || '').split('\n');
  const out = [];
  let list = null;
  let inCode = false;
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    if (line.startsWith('```')) { closeList(); out.push(inCode ? '</code></pre>' : '<pre><code>'); inCode = !inCode; continue; }
    if (inCode) { out.push(line + '\n'); continue; }
    let m;
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { closeList(); out.push(`<h3>${inline(m[1])}</h3>`); }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (!line.trim()) { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('');
}

const fmt = {
  dt(iso) {
    if (!iso) return '';
    return new Intl.DateTimeFormat(undefined, { timeZone: state.tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  },
  rel(iso) {
    const diff = (Date.parse(iso) - Date.now()) / 1000;
    const abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    if (abs < 60) return rtf.format(Math.round(diff), 'second');
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
  },
  // ISO → value for <input type="datetime-local"> in browser-local time
  local(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  },
};

function toast(message, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, message);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}

// ───────────────────────── API ─────────────────────────
const state = { tz: undefined, status: null, conversationId: null, tokenKey: 'jarvis.token' };

function getToken() {
  try { return sessionStorage.getItem(state.tokenKey) || ''; } catch { return ''; }
}
function setToken(v) {
  try { v ? sessionStorage.setItem(state.tokenKey, v) : sessionStorage.removeItem(state.tokenKey); } catch { /* ignore */ }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    askForToken();
    throw new Error('Access token required.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function askForToken() {
  if ($('#token-form')) return;
  const input = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'JARVIS_ACCESS_TOKEN' });
  openModal(h('form', {
    id: 'token-form',
    onsubmit: (e) => { e.preventDefault(); setToken(input.value.trim()); closeModal(); route(); },
  },
  h('h2', {}, icon('shield'), 'Access token'),
  h('p', { class: 'muted small' }, 'This JARVIS server requires the access token set in its .env file. It is kept only for this browser session.'),
  input,
  h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Unlock'))));
  setTimeout(() => input.focus(), 50);
}

// ───────────────────────── chrome ─────────────────────────
const NAV = [
  ['home', 'Home', 'home'],
  ['chat', 'AI Chat', 'chat'],
  ['today', 'Today', 'sun'],
  ['email', 'Email', 'mail'],
  ['calendar', 'Calendar', 'cal'],
  ['tasks', 'Tasks', 'list'],
  ['research', 'Research', 'search'],
  ['documents', 'Documents', 'file'],
  ['automations', 'Automations', 'auto'],
  ['memory', 'Memory', 'brain'],
  ['activity', 'Activity', 'pulse'],
  ['settings', 'Settings', 'gear'],
];

function renderNav(current) {
  const nav = $('#nav');
  nav.replaceChildren(...NAV.map(([id, label, ic]) => h('a', {
    href: `#/${id}`, class: `nav-item${id === current ? ' active' : ''}`, 'aria-current': id === current ? 'page' : null,
    onclick: () => toggleSidebar(false),
  }, icon(ic), label)));
}
function toggleSidebar(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#scrim').classList.toggle('open', open);
}

async function refreshChrome() {
  try {
    const s = await api('/status');
    state.status = s;
    state.tz = s.timezone;
    const pa = s.counts.pendingApprovals;
    const un = s.counts.unreadNotifications;
    $('#approvals-badge').hidden = !pa; $('#approvals-badge').textContent = pa;
    $('#notif-badge').hidden = !un; $('#notif-badge').textContent = un;
    const ai = s.ai;
    $('#engine-status').replaceChildren(
      h('div', { class: 'row' }, h('span', { class: `dot ${ai.configured ? 'ok' : 'err'}` }), h('strong', {}, 'AI engine')),
      h('div', { class: 'dim', style: 'margin-top:4px' }, ai.configured ? `${ai.label} · ${ai.model}` : `Not configured — set ${ai.missing.join(', ')}`),
    );
  } catch { /* shown elsewhere */ }
}

// ───────────────────────── modal / approvals ─────────────────────────
function openModal(content) {
  const root = $('#modal-root');
  fill(root, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content));
  root.onclick = (e) => { if (e.target === root) closeModal(); };
}
function closeModal() { $('#modal-root').replaceChildren(); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });

const ACTION_LABELS = { 'event.delete': 'Delete event', 'task.delete': 'Delete task', 'memory.delete': 'Delete memory', 'draft.send': 'Send draft' };

async function showApproval(id) {
  const a = await api(`/approvals/${id}`);
  const pending = a.status === 'pending';
  const statusPill = { pending: 'warn', executed: 'ok', failed: 'err', rejected: '' }[a.status];
  openModal([
    h('h2', {}, icon('shield'), pending ? 'Approval required' : 'Approval details'),
    h('p', { class: 'muted small' }, pending ? 'JARVIS will not do this unless you confirm.' : `Requested ${fmt.dt(a.created_at)}`),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Action'), h('dd', {}, ACTION_LABELS[a.action_type] || a.action_type),
      h('dt', {}, 'Summary'), h('dd', {}, a.summary),
      h('dt', {}, 'Target'), h('dd', {}, a.target || '—'),
      h('dt', {}, 'Requested by'), h('dd', {}, a.requested_by),
      h('dt', {}, 'Status'), h('dd', {}, h('span', { class: `pill ${statusPill}` }, a.status)),
      a.result && a.result !== 'executing' ? [h('dt', {}, 'Result'), h('dd', {}, a.result)] : null,
    ),
    a.content ? [h('div', { class: 'dim', style: 'margin-bottom:6px' }, 'Content'), h('div', { class: 'preview' }, a.content)] : null,
    h('div', { class: 'modal-actions' },
      pending
        ? [
          h('button', { class: 'btn', onclick: async () => { await api(`/approvals/${a.id}/reject`, { method: 'POST' }); closeModal(); toast('Cancelled. Nothing was done.'); refreshAll(); } }, 'Cancel'),
          h('button', {
            class: 'btn primary', onclick: async (e) => {
              e.target.disabled = true;
              const r = await api(`/approvals/${a.id}/confirm`, { method: 'POST' }).catch((err) => ({ status: 'failed', result: err.message }));
              closeModal();
              toast(r.status === 'executed' ? `Done: ${r.result}` : `Failed: ${r.result}`, r.status === 'executed' ? '' : 'err');
              refreshAll();
            },
          }, 'Confirm'),
        ]
        : h('button', { class: 'btn', onclick: closeModal }, 'Close'),
    ),
  ]);
}

async function showApprovalsList() {
  const list = await api('/approvals?status=pending');
  openModal([
    h('h2', {}, icon('shield'), 'Pending approvals'),
    list.length
      ? h('div', { class: 'list section-gap' }, list.map((a) => h('div', { class: 'item' },
        h('div', { class: 'item-body' }, h('div', { class: 'item-title' }, a.summary), h('div', { class: 'item-meta' }, a.target, '·', fmt.rel(a.created_at))),
        h('button', { class: 'btn sm primary', onclick: () => showApproval(a.id) }, 'Review'))))
      : emptyState('shield', 'Nothing awaiting approval', 'Sensitive actions JARVIS proposes (sending, deleting) appear here for you to confirm or cancel.'),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: closeModal }, 'Close')),
  ]);
}

// ───────────────────────── notifications drawer ─────────────────────────
function closeDrawer() { $('#drawer').hidden = true; }
async function openDrawer() {
  const d = $('#drawer');
  d.hidden = false;
  const list = await api('/notifications');
  d.replaceChildren(
    h('div', { class: 'card-head' }, h('h2', {}, icon('bell'), 'Notifications'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm ghost', onclick: async () => { await api('/notifications/read-all', { method: 'POST' }); openDrawer(); refreshChrome(); } }, 'Mark all read'),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: closeDrawer }, icon('x'))),
    list.length
      ? h('div', { class: 'list' }, list.map((n) => h('div', { class: 'item', style: n.read ? 'opacity:.6' : '' },
        h('span', { class: `dot ${n.level === 'error' ? 'err' : n.level === 'warning' ? 'warn' : 'ok'}`, style: 'margin-top:7px' }),
        h('div', { class: 'item-body' },
          h('div', { class: 'item-title' }, n.title), h('div', { class: 'small muted' }, n.body), h('div', { class: 'dim' }, fmt.rel(n.created_at))),
        n.link ? h('button', {
          class: 'btn sm', onclick: async () => {
            await api(`/notifications/${n.id}/read`, { method: 'POST' });
            closeDrawer(); refreshChrome();
            const m = n.link.match(/^#\/approvals\/(\d+)/);
            if (m) showApproval(m[1]); else location.hash = n.link;
          },
        }, 'Open') : null)))
      : emptyState('bell', 'All quiet', 'Reminders, approval requests and failures will show up here.'),
  );
}

// ───────────────────────── shared UI ─────────────────────────
function emptyState(ic, title, text, action) {
  return h('div', { class: 'empty' }, icon(ic), h('h4', {}, title), h('p', {}, text), action ? h('div', { style: 'margin-top:12px' }, action) : null);
}
function notConnected(name, needs, extra) {
  return h('div', { class: 'notice' }, icon('shield'),
    h('div', {}, h('strong', {}, `${name} is not connected.`), ' ',
      'JARVIS will not show or invent data from this service until it is connected. ',
      needs?.length ? ['Needs: ', h('code', {}, needs.join(', ')), '. '] : null,
      extra || ''));
}
function loading() { return h('div', { class: 'card' }, h('div', { class: 'skeleton', style: 'width:40%' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton', style: 'width:70%' })); }
const PRIO = { top: 'Top 3 priorities', important: 'Important', routine: 'Routine', upcoming: 'Upcoming' };
const integ = (id) => state.status?.integrations.find((i) => i.id === id);

function taskItem(t, onChange) {
  const done = t.status === 'done';
  const overdue = t.due_at && !done && Date.parse(t.due_at) < Date.now();
  return h('div', { class: `item${done ? ' done' : ''}` },
    h('button', {
      class: `checkbox${done ? ' on' : ''}`, 'aria-label': done ? 'Mark as not done' : 'Mark as done',
      onclick: async () => { await api(`/tasks/${t.id}`, { method: 'PATCH', body: { status: done ? 'pending' : 'done' } }); onChange?.(); },
    }, done ? icon('check') : null),
    h('div', { class: 'item-body' },
      h('div', { class: 'item-title' }, t.title),
      t.reason ? h('div', { class: 'reason' }, t.reason) : null,
      h('div', { class: 'item-meta' },
        h('span', { class: `pill p-${t.priority}` }, PRIO[t.priority].replace('Top 3 priorities', 'Top 3')),
        t.status === 'in_progress' ? h('span', { class: 'pill info' }, 'in progress') : null,
        t.due_at ? h('span', { class: overdue ? 'pill err' : '' }, icon('clock', ''), ' ', fmt.dt(t.due_at), overdue ? ' · overdue' : '') : null,
        t.project ? h('span', {}, `# ${t.project}`) : null)),
    h('div', { class: 'item-actions' },
      h('button', { class: 'icon-btn', 'aria-label': 'Edit task', onclick: () => taskForm(t, onChange) }, icon('edit')),
      h('button', {
        class: 'icon-btn', 'aria-label': 'Delete task',
        onclick: () => confirmDialog(`Delete task "${t.title}"?`, 'This permanently removes the task. To keep a record, mark it cancelled instead.', async () => {
          await api(`/tasks/${t.id}`, { method: 'DELETE' }); toast('Task deleted.'); onChange?.();
        }),
      }, icon('trash'))));
}

function confirmDialog(title, text, onConfirm, label = 'Delete') {
  openModal([
    h('h2', {}, icon('shield'), title), h('p', { class: 'muted' }, text),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn danger', onclick: async () => { closeModal(); try { await onConfirm(); } catch (e) { toast(e.message, 'err'); } } }, label)),
  ]);
}

function taskForm(task, onDone) {
  const f = {
    title: h('input', { class: 'input', required: true, maxlength: 300, value: task?.title || '' }),
    priority: h('select', { class: 'input' }, Object.entries(PRIO).map(([v, l]) => h('option', { value: v, selected: (task?.priority || 'important') === v }, l))),
    status: h('select', { class: 'input' }, ['pending', 'in_progress', 'done', 'cancelled'].map((s) => h('option', { value: s, selected: (task?.status || 'pending') === s }, s.replace('_', ' ')))),
    due_at: h('input', { class: 'input', type: 'datetime-local', value: fmt.local(task?.due_at) }),
    project: h('input', { class: 'input', value: task?.project || '' }),
    reason: h('input', { class: 'input', placeholder: 'Why it matters (optional)', value: task?.reason || '' }),
    notes: h('textarea', { class: 'input' }, task?.notes || ''),
  };
  openModal(h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const body = {
        title: f.title.value, priority: f.priority.value, project: f.project.value, reason: f.reason.value, notes: f.notes.value,
        due_at: f.due_at.value ? new Date(f.due_at.value).toISOString() : null,
      };
      if (task) body.status = f.status.value;
      try {
        await api(task ? `/tasks/${task.id}` : '/tasks', { method: task ? 'PATCH' : 'POST', body });
        closeModal(); toast(task ? 'Task updated.' : 'Task added.'); onDone?.();
      } catch (err) { toast(err.message, 'err'); }
    },
  },
  h('h2', {}, task ? 'Edit task' : 'New task'),
  h('div', { class: 'form-grid section-gap' },
    h('label', { class: 'field full' }, 'Title', f.title),
    h('label', { class: 'field' }, 'Priority', f.priority),
    task ? h('label', { class: 'field' }, 'Status', f.status) : h('label', { class: 'field' }, 'Due', f.due_at),
    task ? h('label', { class: 'field' }, 'Due', f.due_at) : null,
    h('label', { class: 'field' }, 'Project', f.project),
    h('label', { class: 'field full' }, 'Reason', f.reason),
    h('label', { class: 'field full' }, 'Notes', f.notes)),
  h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
  setTimeout(() => f.title.focus(), 50);
}

function reminderForm(rem, onDone) {
  const msg = h('input', { class: 'input', required: true, maxlength: 500, value: rem?.message || '' });
  const def = rem?.remind_at || new Date(Date.now() + 3600e3).toISOString();
  const at = h('input', { class: 'input', type: 'datetime-local', required: true, value: fmt.local(def) });
  openModal(h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const body = { message: msg.value, remind_at: new Date(at.value).toISOString() };
        await api(rem ? `/reminders/${rem.id}` : '/reminders', { method: rem ? 'PATCH' : 'POST', body });
        closeModal(); toast(rem ? 'Reminder updated.' : 'Reminder set.'); onDone?.();
      } catch (err) { toast(err.message, 'err'); }
    },
  }, h('h2', {}, icon('clock'), rem ? 'Edit reminder' : 'New reminder'),
  h('div', { class: 'stack section-gap' }, h('label', { class: 'field' }, 'Remind me to…', msg), h('label', { class: 'field' }, 'When', at)),
  h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
}

function reminderItem(r, onChange) {
  return h('div', { class: 'item' }, icon('clock'),
    h('div', { class: 'item-body' }, h('div', { class: 'item-title' }, r.message), h('div', { class: 'item-meta' }, fmt.dt(r.remind_at), '·', fmt.rel(r.remind_at))),
    h('div', { class: 'item-actions' },
      h('button', { class: 'icon-btn', 'aria-label': 'Edit reminder', onclick: () => reminderForm(r, onChange) }, icon('edit')),
      h('button', { class: 'icon-btn', 'aria-label': 'Cancel reminder', onclick: async () => { await api(`/reminders/${r.id}/cancel`, { method: 'POST' }); toast('Reminder cancelled.'); onChange?.(); } }, icon('x'))));
}

function askBox({ placeholder = 'What would you like me to do?', autofocus = false } = {}) {
  const ta = h('textarea', { rows: 1, placeholder, 'aria-label': 'Ask JARVIS' });
  const go = () => {
    const v = ta.value.trim();
    if (!v) return;
    sessionStorage.setItem('jarvis.pending', v);
    state.conversationId = null;
    location.hash = '#/chat';
  };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
  if (autofocus) setTimeout(() => ta.focus(), 50);
  return h('div', { class: 'composer' }, ta, micButton(ta), h('button', { class: 'btn primary icon', 'aria-label': 'Send', onclick: go }, icon('send')));
}

// Browser speech-to-text for dictation (no server dependency). Hidden if unsupported.
function micButton(textarea) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  let rec = null;
  const btn = h('button', {
    class: 'btn ghost icon', type: 'button', 'aria-label': 'Dictate', onclick: () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
      const base = textarea.value ? textarea.value + ' ' : '';
      rec.onresult = (e) => { textarea.value = base + Array.from(e.results).map((r) => r[0].transcript).join(''); textarea.dispatchEvent(new Event('input')); };
      rec.onend = () => { rec = null; btn.classList.remove('mic-on'); };
      rec.onerror = (e) => toast(`Voice input: ${e.error}`, 'err');
      btn.classList.add('mic-on');
      rec.start();
    },
  }, icon('mic'));
  return btn;
}

// ───────────────────────── views ─────────────────────────
const views = {};

views.home = async (root) => {
  const d = await api('/dashboard');
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: state.tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const t = d.tasks;
  const top = t.groups.top.slice(0, 3);
  const email = d.integrations.find((i) => i.id === 'email');
  const research = d.integrations.find((i) => i.id === 'research');
  const max = Math.max(1, ...Object.values(t.byPriority));

  fill(root, 
    h('div', { class: 'hero' },
      h('div', { class: 'eyebrow' }, greet),
      h('h1', {}, d.status.userName ? `Welcome back, ${d.status.userName}.` : 'Welcome back.'),
      h('p', {}, d.status.ai.configured ? 'Your daily briefing is ready.' : 'Connect an AI provider in .env to enable conversational briefings.'),
      h('div', { class: 'brief-grid' },
        h('a', { class: 'brief', href: '#/email' }, icon('mail'), h('div', { class: 'label' }, 'EMAILS'),
          h('div', { class: 'sub' }, email.connected ? `Inbox · ${email.account || 'Gmail'}` : email.status === 'needs_authorization' ? 'Ready to connect' : 'Not connected'), h('div', { class: 'value' }, `${d.drafts.length}`), h('div', { class: 'sub' }, 'drafts awaiting review')),
        h('a', { class: 'brief', href: '#/calendar' }, icon('cal'), h('div', { class: 'label' }, 'CALENDAR'),
          h('div', { class: 'sub' }, "Today's schedule"), h('div', { class: 'value' }, `${d.today.events.length}`), h('div', { class: 'sub' }, `event${d.today.events.length === 1 ? '' : 's'} today · ${d.tomorrow.events.length} tomorrow`)),
        h('a', { class: 'brief', href: '#/today' }, icon('check'), h('div', { class: 'label' }, 'TASKS'),
          h('div', { class: 'sub' }, 'Your priorities'), h('div', { class: 'value' }, `${t.open}`), h('div', { class: 'sub' }, `open · ${t.overdue} overdue`)),
        h('a', { class: 'brief', href: '#/research' }, icon('spark'), h('div', { class: 'label' }, 'INTELLIGENCE'),
          h('div', { class: 'sub' }, research.connected ? 'Latest updates' : 'Web research not connected'), h('div', { class: 'value' }, `${d.memoryCount}`), h('div', { class: 'sub' }, 'facts in memory'))),
      h('div', { class: 'ask' }, h('label', {}, icon('spark'), 'Ask JARVIS'), askBox())),

    d.approvals.length ? h('div', { class: 'notice section-gap' }, icon('shield'),
      h('div', { style: 'flex:1' }, h('strong', {}, `${d.approvals.length} action${d.approvals.length > 1 ? 's' : ''} awaiting your approval.`), ' Nothing is sent or deleted until you confirm.'),
      h('button', { class: 'btn sm primary', onclick: showApprovalsList }, 'Review')) : null,

    h('div', { class: 'grid g3 section-gap' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, icon('sun'), 'Top 3 priorities'), h('span', { class: 'spacer' }), h('a', { href: '#/today', class: 'small' }, 'All')),
        top.length ? h('div', { class: 'list' }, top.map((x) => taskItem(x, () => route())))
          : emptyState('check', 'No top priorities set', 'Add tasks or ask JARVIS to organize your day.', h('button', { class: 'btn sm', onclick: () => taskForm(null, () => route()) }, icon('plus'), 'Add task'))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, icon('list'), 'Workload'), h('span', { class: 'spacer' }), h('span', { class: 'dim' }, `${t.doneLast24h} done in 24h`)),
        h('div', { class: 'bars' }, Object.entries(t.byPriority).map(([p, n]) => h('div', { class: 'bar-row' },
          h('span', { class: 'muted' }, PRIO[p].replace(' priorities', '')),
          h('div', { class: 'bar-track', role: 'img', 'aria-label': `${n} ${p} tasks` }, h('div', { class: `bar-fill ${p === 'top' ? 'top' : ''}`, style: `width:${(n / max) * 100}%` })),
          h('strong', {}, n))))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, icon('clock'), 'Reminders'), h('span', { class: 'spacer' }), h('button', { class: 'btn sm ghost', onclick: () => reminderForm(null, () => route()) }, icon('plus'))),
        d.reminders.length ? h('div', { class: 'list' }, d.reminders.slice(0, 4).map((r) => reminderItem(r, () => route())))
          : emptyState('clock', 'No reminders', 'Try: "Remind me to call Priya tomorrow at 10am."'))),

    h('div', { class: 'grid g2 section-gap' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, icon('gear'), 'Systems'), h('span', { class: 'spacer' }), h('a', { href: '#/settings', class: 'small' }, 'Configure')),
        h('div', { class: 'list' }, d.integrations.map((i) => h('div', { class: 'item' },
          h('span', { class: `dot ${i.connected ? 'ok' : i.status === 'not_configured' ? 'err' : ''}`, style: 'margin-top:7px' }),
          h('div', { class: 'item-body' }, h('div', { class: 'item-title' }, i.name)),
          h('span', { class: `pill ${i.connected ? 'ok' : i.status === 'not_configured' ? 'err' : ''}` }, i.connected ? 'online' : i.status === 'not_implemented' ? `phase ${i.phase}` : 'needs config'))))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, icon('pulse'), 'Recent activity'), h('span', { class: 'spacer' }), h('a', { href: '#/activity', class: 'small' }, 'All')),
        d.activity.length ? h('div', { class: 'list' }, d.activity.map((a) => h('div', { class: 'item' },
          h('div', { class: 'item-body' }, h('div', { class: 'small' }, a.message), h('div', { class: 'dim' }, fmt.rel(a.created_at))))))
          : emptyState('pulse', 'No activity yet', 'Everything JARVIS does is logged here.'))),
  );
};

views.chat = async (root) => {
  const convs = await api('/conversations');
  const messages = h('div', { class: 'messages', 'aria-live': 'polite' });
  const ta = h('textarea', { rows: 1, placeholder: 'Message JARVIS…  (Enter to send, Shift+Enter for a new line)', 'aria-label': 'Message' });
  const sendBtn = h('button', { class: 'btn primary icon', 'aria-label': 'Send' }, icon('send'));
  const ai = state.status?.ai;

  const bubble = (role, content, extra = {}) => {
    const el = h('div', { class: `msg ${role}${extra.error ? ' error' : ''}` },
      role === 'assistant' ? h('div', { class: 'who' }, 'JARVIS') : null,
      role === 'assistant' ? h('div', { class: 'md', html: md(content) }) : content,
      extra.actions?.length ? h('div', { class: 'actions-used' }, extra.actions.map((a) => a.approvalId
        ? h('button', { class: 'pill warn', style: 'cursor:pointer', onclick: () => showApproval(a.approvalId) }, icon('shield'), 'Awaiting approval — review')
        : h('span', { class: `pill ${a.ok ? 'info' : 'err'}`, title: a.error || '' }, a.ok ? '✓ ' : '✕ ', a.tool.replace(/_/g, ' ')))) : null);
    messages.append(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  };

  const SUGGEST = ['What are my priorities today?', 'Add a top-priority task to finish the Q4 report by Friday 5pm', 'Remind me to call the vendor tomorrow at 10am', 'Remember: I prefer short, direct emails', 'Draft a status update for my manager'];
  const showWelcome = () => messages.replaceChildren(h('div', { class: 'empty', style: 'margin:auto' }, icon('spark'),
    h('h4', {}, 'How can I help?'),
    h('p', {}, 'I can organize your tasks, set reminders, remember preferences and prepare drafts. Sending and deleting always need your approval.'),
    h('div', { class: 'suggestions' }, SUGGEST.map((s) => h('button', { class: 'tab', onclick: () => { ta.value = s; send(); } }, s)))));

  async function loadConversation(id) {
    state.conversationId = id;
    if (!id) return showWelcome();
    const c = await api(`/conversations/${id}`);
    messages.replaceChildren();
    for (const m of c.messages) bubble(m.role, m.content);
  }

  let busy = false;
  async function send() {
    const text = ta.value.trim();
    if (!text || busy) return;
    if (!state.conversationId) messages.replaceChildren();
    busy = true; sendBtn.disabled = true;
    ta.value = ''; ta.style.height = 'auto';
    bubble('user', text);
    const typing = h('div', { class: 'msg assistant' }, h('div', { class: 'who' }, 'JARVIS'), h('span', { class: 'typing' }, h('i'), h('i'), h('i')));
    messages.append(typing); messages.scrollTop = messages.scrollHeight;
    try {
      const r = await api('/chat', { method: 'POST', body: { message: text, conversationId: state.conversationId } });
      typing.remove();
      const isNew = !state.conversationId;
      state.conversationId = r.conversationId;
      bubble('assistant', r.reply, { actions: r.actions });
      if (isNew) renderConvs(await api('/conversations'));
    } catch (err) {
      typing.remove();
      bubble('assistant', err.message, { error: true });
    } finally {
      busy = false; sendBtn.disabled = false; ta.focus(); refreshChrome();
    }
  }
  sendBtn.onclick = send;
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });

  const convList = h('div', { class: 'card conv-list' });
  function renderConvs(list) {
    convList.replaceChildren(
      h('button', { class: 'btn primary', style: 'width:100%;margin-bottom:10px', onclick: () => { loadConversation(null); renderConvs(list); } }, icon('plus'), 'New chat'),
      ...list.map((c) => h('div', { class: `conv${c.id === state.conversationId ? ' active' : ''}`, onclick: () => { loadConversation(c.id); renderConvs(list); } },
        h('span', {}, c.title),
        h('button', {
          class: 'icon-btn', style: 'width:26px;height:26px', 'aria-label': 'Delete conversation',
          onclick: (e) => {
            e.stopPropagation();
            confirmDialog('Delete this conversation?', 'The chat transcript is removed. Tasks, reminders and memories it created are kept.', async () => {
              await api(`/conversations/${c.id}`, { method: 'DELETE' });
              if (state.conversationId === c.id) loadConversation(null);
              renderConvs(await api('/conversations'));
            });
          },
        }, icon('trash')))),
    );
  }

  fill(root, h('div', { class: 'chat' },
    convList,
    h('div', { class: 'card chat-main' },
      ai && !ai.configured ? h('div', { class: 'notice', style: 'margin:14px 14px 0' }, icon('shield'),
        h('div', {}, h('strong', {}, 'AI engine not configured. '), 'Set ', h('code', {}, ai.missing.join(', ')), ' in ', h('code', {}, '.env'), ' and restart JARVIS.')) : null,
      messages,
      h('div', { class: 'chat-input' }, h('div', { class: 'composer' }, ta, micButton(ta), sendBtn)))));

  renderConvs(convs);
  await loadConversation(state.conversationId);
  const pending = sessionStorage.getItem('jarvis.pending');
  if (pending) { sessionStorage.removeItem('jarvis.pending'); ta.value = pending; send(); } else ta.focus();
};

views.today = async (root) => {
  const [d] = await Promise.all([api('/dashboard')]);
  const t = d.tasks;
  const reload = () => route();
  const col = (p, ic) => h('div', { class: `card prio-col ${p}` },
    h('h3', {}, icon(ic), PRIO[p], h('span', { class: 'count' }, t.groups[p].length)),
    t.groups[p].length ? h('div', { class: 'list' }, t.groups[p].map((x) => taskItem(x, reload))) : h('div', { class: 'dim' }, 'Nothing here.'));
  const now = new Intl.DateTimeFormat(undefined, { timeZone: state.tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  fill(root, 
    h('div', { class: 'row', style: 'margin-bottom:16px' },
      h('div', {}, h('div', { class: 'eyebrow' }, now), h('div', { class: 'muted small' }, `${t.open} open · ${t.overdue} overdue · ${t.doneLast24h} completed in the last 24h`)),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => taskForm(null, reload) }, icon('plus'), 'Task'),
      h('button', { class: 'btn primary', onclick: () => { sessionStorage.setItem('jarvis.pending', 'Prepare my daily briefing: organize my open tasks into TOP 3 PRIORITIES, IMPORTANT, ROUTINE and UPCOMING with a one-line reason for each top priority, list overdue items and today\'s reminders, and tell me which integrations are not connected so I know what is missing from this briefing.'); state.conversationId = null; location.hash = '#/chat'; } }, icon('spark'), 'Generate briefing')),
    t.overdue ? h('div', { class: 'notice', style: 'margin-bottom:16px' }, icon('clock'), h('div', {}, h('strong', {}, `${t.overdue} overdue task${t.overdue > 1 ? 's' : ''}.`), ' Reschedule, complete, or cancel them — JARVIS never removes unfinished tasks silently.')) : null,
    h('div', { class: 'grid g2' }, col('top', 'spark'), col('important', 'check')),
    h('div', { class: 'grid g2 section-gap' }, col('routine', 'list'), col('upcoming', 'cal')),
    h('div', { class: 'card section-gap' }, h('h3', {}, icon('clock'), 'Reminders'),
      d.reminders.length ? h('div', { class: 'list' }, d.reminders.map((r) => reminderItem(r, reload))) : h('div', { class: 'dim' }, 'No reminders scheduled.')),
  );
};

views.tasks = async (root) => {
  const filter = sessionStorage.getItem('jarvis.taskFilter') || 'open';
  const q = filter === 'open' ? '' : filter === 'all' ? '?all=1' : `?status=${filter}`;
  const [tasks, reminders] = await Promise.all([api(`/tasks${q}`), api('/reminders')]);
  const reload = () => route();
  const tabs = [['open', 'Open'], ['done', 'Done'], ['cancelled', 'Cancelled'], ['all', 'All']];
  fill(root, 
    h('div', { class: 'row', style: 'margin-bottom:6px' },
      h('div', { class: 'tabs', style: 'margin:0' }, tabs.map(([k, l]) => h('button', { class: `tab${k === filter ? ' active' : ''}`, onclick: () => { sessionStorage.setItem('jarvis.taskFilter', k); route(); } }, l))),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => reminderForm(null, reload) }, icon('clock'), 'Reminder'),
      h('button', { class: 'btn primary', onclick: () => taskForm(null, reload) }, icon('plus'), 'New task')),
    h('div', { class: 'grid section-gap', style: 'grid-template-columns: minmax(0,2fr) minmax(0,1fr)' },
      h('div', { class: 'card' }, h('h3', {}, icon('list'), `${tasks.length} task${tasks.length === 1 ? '' : 's'}`),
        tasks.length ? h('div', { class: 'list' }, tasks.map((t) => taskItem(t, reload)))
          : emptyState('check', 'No tasks here', 'Create one, or tell JARVIS what you need to get done.')),
      h('div', { class: 'card' }, h('h3', {}, icon('clock'), 'Reminders'),
        reminders.length ? h('div', { class: 'list' }, reminders.map((r) => reminderItem(r, reload))) : h('div', { class: 'dim' }, 'No reminders scheduled.'))),
  );
  if (matchMedia('(max-width: 860px)').matches) root.querySelector('.grid').style.gridTemplateColumns = '1fr';
};

views.email = async (root) => {
  const e = integ('email');
  const params = new URLSearchParams((location.hash.split('?')[1]) || '');
  if (params.get('connected')) { toast('Gmail connected.'); history.replaceState(null, '', '#/email'); }
  if (params.get('error')) { toast(params.get('error'), 'err'); history.replaceState(null, '', '#/email'); }
  const drafts = await api('/drafts');
  const reload = () => route();
  const filter = sessionStorage.getItem('jarvis.mailQ') || 'in:inbox';
  let inbox = null;
  let inboxError = null;
  if (e?.connected) {
    try { inbox = await api(`/email/messages?q=${encodeURIComponent(filter)}&max=20`); } catch (err) { inboxError = err.message; }
  }
  const connect = async () => {
    try { const { url } = await api('/integrations/google/auth-url'); location.href = url; } catch (err) { toast(err.message, 'err'); }
  };
  const FILTERS = [['in:inbox', 'Inbox'], ['is:unread in:inbox', 'Unread'], ['is:important newer_than:7d', 'Important'], ['in:sent', 'Sent']];

  let inboxCard;
  if (!e || e.status === 'not_configured') {
    inboxCard = h('div', { class: 'notice' }, icon('mail'), h('div', {},
      h('strong', {}, 'Gmail is not set up yet. '),
      'Create a Google OAuth client, then add ', h('code', {}, 'GOOGLE_CLIENT_ID'), ' and ', h('code', {}, 'GOOGLE_CLIENT_SECRET'),
      ' to .env and restart. Step-by-step guide: ', h('code', {}, 'docs/SETUP-GMAIL.md'), '.'));
  } else if (e.status === 'needs_authorization') {
    inboxCard = h('div', { class: 'card' }, emptyState('mail', 'Connect your Gmail',
      'JARVIS will ask Google for permission to read your mail and to send mail. Nothing is ever sent without your approval, and you can disconnect at any time.',
      h('button', { class: 'btn primary', onclick: connect }, icon('mail'), 'Connect Gmail')));
  } else {
    inboxCard = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, icon('mail'), 'Inbox'), h('span', { class: 'dim' }, e.account || ''), h('span', { class: 'spacer' }),
        h('button', {
          class: 'btn sm primary', onclick: () => {
            sessionStorage.setItem('jarvis.pending', 'Summarize my important and unread emails from the last 2 days. Group them into: needs a reply, deadlines/requests, and FYI. For each one needing a reply, suggest a short response.');
            state.conversationId = null; location.hash = '#/chat';
          },
        }, icon('spark'), 'Summarize with JARVIS')),
      h('div', { class: 'tabs' }, FILTERS.map(([q, l]) => h('button', { class: `tab${q === filter ? ' active' : ''}`, onclick: () => { sessionStorage.setItem('jarvis.mailQ', q); route(); } }, l))),
      inboxError ? h('div', { class: 'notice' }, icon('shield'), h('div', {}, inboxError))
        : inbox.length ? h('div', { class: 'list' }, inbox.map((m) => h('div', { class: 'item', style: 'cursor:pointer', onclick: () => showEmail(m.id) },
          h('span', { class: `dot ${m.unread ? 'ok' : ''}`, style: 'margin-top:8px', title: m.unread ? 'Unread' : 'Read' }),
          h('div', { class: 'item-body' },
            h('div', { class: 'item-title', style: m.unread ? 'font-weight:700' : '' }, m.subject),
            h('div', { class: 'item-meta' }, m.from.replace(/<.*>/, '').trim() || m.from, '·', fmt.dt(m.date), m.important ? h('span', { class: 'pill warn' }, 'important') : null),
            h('div', { class: 'small muted', style: 'margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, m.snippet)))))
          : emptyState('mail', 'No messages', 'Nothing matches this view.'));
  }

  fill(root,
    inboxCard,
    h('div', { class: 'card section-gap' },
      h('div', { class: 'card-head' }, h('h2', {}, icon('edit'), 'Drafts'), h('span', { class: 'spacer' }), h('button', { class: 'btn sm', onclick: () => draftForm(null, reload) }, icon('plus'), 'New draft')),
      drafts.length ? h('div', { class: 'list' }, drafts.map((d) => h('div', { class: 'item' },
        h('div', { class: 'item-body' },
          h('div', { class: 'item-title' }, d.subject || '(no subject)'),
          h('div', { class: 'item-meta' }, h('span', { class: 'pill' }, d.kind.replace('_', ' ')), d.recipient ? `To: ${d.recipient}` : 'No recipient', '·', fmt.rel(d.updated_at),
            d.status === 'pending_approval' ? h('span', { class: 'pill warn' }, 'awaiting approval') : null),
          h('div', { class: 'small muted', style: 'margin-top:6px;white-space:pre-wrap;max-height:4.5em;overflow:hidden' }, d.body)),
        h('div', { class: 'item-actions' },
          h('button', { class: 'icon-btn', 'aria-label': 'Edit draft', onclick: () => draftForm(d, reload) }, icon('edit')),
          d.status === 'draft' ? h('button', { class: 'btn sm', onclick: async () => { try { const a = await api(`/drafts/${d.id}/request-send`, { method: 'POST' }); showApproval(a.id); } catch (err) { toast(err.message, 'err'); } } }, icon('send'), 'Send…') : null,
          h('button', { class: 'icon-btn', 'aria-label': 'Discard draft', onclick: () => confirmDialog('Discard this draft?', 'It will be hidden from your drafts list (kept in the database for the record).', async () => { await api(`/drafts/${d.id}/discard`, { method: 'POST' }); reload(); }, 'Discard') }, icon('trash'))))))
        : emptyState('edit', 'No drafts', 'Ask JARVIS: "Draft a reply to Sam declining Thursday\'s meeting, friendly tone." Drafts are never sent without your approval.')),
  );
};

async function showEmail(id) {
  openModal(h('div', {}, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
  try {
    const m = await api(`/email/messages/${encodeURIComponent(id)}`);
    openModal([
      h('h2', {}, icon('mail'), m.subject),
      h('dl', { class: 'kv' }, h('dt', {}, 'From'), h('dd', {}, m.from), h('dt', {}, 'To'), h('dd', {}, m.to), h('dt', {}, 'Date'), h('dd', {}, fmt.dt(m.date))),
      h('div', { class: 'preview', style: 'max-height:50vh' }, m.body || m.snippet),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: closeModal }, 'Close'),
        h('button', {
          class: 'btn primary', onclick: () => {
            closeModal();
            sessionStorage.setItem('jarvis.pending', `Read email id ${m.id} ("${m.subject}") and draft a reply in my usual writing style. Save it as a draft; do not send.`);
            state.conversationId = null; location.hash = '#/chat';
          },
        }, icon('spark'), 'Draft reply with JARVIS')),
    ]);
  } catch (err) { closeModal(); toast(err.message, 'err'); }
}

function draftForm(d, onDone) {
  const kind = h('select', { class: 'input' }, ['email', 'message', 'status_update'].map((k) => h('option', { value: k, selected: d?.kind === k }, k.replace('_', ' '))));
  const to = h('input', { class: 'input', value: d?.recipient || '' });
  const subject = h('input', { class: 'input', value: d?.subject || '' });
  const body = h('textarea', { class: 'input', required: true, style: 'min-height:200px' }, d?.body || '');
  if (d) kind.disabled = true;
  openModal(h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api(d ? `/drafts/${d.id}` : '/drafts', { method: d ? 'PATCH' : 'POST', body: { kind: kind.value, recipient: to.value, subject: subject.value, body: body.value } });
        closeModal(); toast('Draft saved. Nothing was sent.'); onDone?.();
      } catch (err) { toast(err.message, 'err'); }
    },
  }, h('h2', {}, icon('mail'), d ? 'Edit draft' : 'New draft'),
  h('div', { class: 'form-grid section-gap' }, h('label', { class: 'field' }, 'Type', kind), h('label', { class: 'field' }, 'To', to),
    h('label', { class: 'field full' }, 'Subject', subject), h('label', { class: 'field full' }, 'Body', body)),
  h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save draft'))));
}

function eventForm(ev, onDone, defaultDay) {
  const start = ev?.starts_at || (() => { const d = defaultDay ? new Date(defaultDay) : new Date(); d.setMinutes(0, 0, 0); d.setHours(Math.max(d.getHours() + 1, 9)); return d.toISOString(); })();
  const f = {
    title: h('input', { class: 'input', required: true, maxlength: 300, value: ev?.title || '' }),
    starts: h('input', { class: 'input', type: 'datetime-local', required: true, value: fmt.local(start) }),
    ends: h('input', { class: 'input', type: 'datetime-local', value: fmt.local(ev?.ends_at || new Date(Date.parse(start) + 3600e3).toISOString()) }),
    location: h('input', { class: 'input', value: ev?.location || '' }),
    notes: h('textarea', { class: 'input' }, ev?.notes || ''),
  };
  openModal(h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const body = {
        title: f.title.value, location: f.location.value, notes: f.notes.value,
        starts_at: new Date(f.starts.value).toISOString(), ends_at: f.ends.value ? new Date(f.ends.value).toISOString() : null,
      };
      try { await api(ev ? `/events/${ev.id}` : '/events', { method: ev ? 'PATCH' : 'POST', body }); closeModal(); toast(ev ? 'Event updated.' : 'Event added.'); onDone?.(); } catch (err) { toast(err.message, 'err'); }
    },
  }, h('h2', {}, icon('cal'), ev ? 'Edit event' : 'New event'),
  h('div', { class: 'form-grid section-gap' },
    h('label', { class: 'field full' }, 'Title', f.title),
    h('label', { class: 'field' }, 'Starts', f.starts), h('label', { class: 'field' }, 'Ends', f.ends),
    h('label', { class: 'field full' }, 'Location', f.location), h('label', { class: 'field full' }, 'Notes', f.notes)),
  h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
  setTimeout(() => f.title.focus(), 50);
}

views.calendar = async (root) => {
  const from = new Date(Date.now() - 6 * 3600e3);
  const to = new Date(Date.now() + 21 * 86400e3);
  const [events, tasks, reminders, tomorrow] = await Promise.all([
    api(`/events?from=${from.toISOString()}&to=${to.toISOString()}`), api('/tasks'), api('/reminders'), api('/schedule?day=tomorrow'),
  ]);
  const reload = () => route();
  const items = [
    ...events.map((ev) => ({ at: ev.starts_at, end: ev.ends_at, title: ev.title, kind: 'Event', ev })),
    ...tasks.filter((t) => t.due_at && Date.parse(t.due_at) < to.getTime()).map((t) => ({ at: t.due_at, title: t.title, kind: 'Deadline' })),
    ...reminders.filter((r) => Date.parse(r.remind_at) < to.getTime()).map((r) => ({ at: r.remind_at, title: r.message, kind: 'Reminder' })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const dayFmt = new Intl.DateTimeFormat(undefined, { timeZone: state.tz, weekday: 'long', month: 'short', day: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { timeZone: state.tz, hour: 'numeric', minute: '2-digit' });
  const byDay = new Map();
  for (const it of items) {
    const k = dayFmt.format(new Date(it.at));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(it);
  }
  const tCount = tomorrow.events.length + tomorrow.tasksDue.length + tomorrow.reminders.length;
  fill(root,
    h('div', { class: 'row', style: 'margin-bottom:16px' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Built-in calendar'), h('div', { class: 'muted small' }, `Times in ${state.tz}. Add plans here or just tell JARVIS.`)),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn primary', onclick: () => eventForm(null, reload) }, icon('plus'), 'New event')),
    h('div', { class: 'card', style: 'margin-bottom:18px;border-color:var(--line-hi)' },
      h('div', { class: 'card-head' }, h('h2', {}, icon('sun'), `Tomorrow · ${tomorrow.label}`), h('span', { class: 'spacer' }),
        h('a', { href: '#/automations', class: 'small' }, 'Bedtime briefing settings')),
      tCount ? h('div', { class: 'muted small' }, `${tomorrow.events.length} event${tomorrow.events.length === 1 ? '' : 's'} · ${tomorrow.tasksDue.length} due · ${tomorrow.reminders.length} reminder${tomorrow.reminders.length === 1 ? '' : 's'}`)
        : h('div', { class: 'row' }, h('span', { class: 'muted small', style: 'flex:1' }, 'Nothing planned for tomorrow yet.'),
          h('button', { class: 'btn sm', onclick: () => eventForm(null, reload, new Date(Date.now() + 86400e3).toISOString()) }, icon('plus'), 'Plan tomorrow'))),
    h('div', { class: 'card' }, h('h2', {}, icon('cal'), 'Next 3 weeks'),
      byDay.size ? [...byDay].map(([day, its]) => h('div', { style: 'margin-bottom:14px' }, h('div', { class: 'eyebrow', style: 'margin-bottom:4px' }, day),
        h('div', { class: 'list' }, its.map((it) => h('div', { class: 'item' },
          h('span', { class: 'muted small', style: 'width:140px;flex:none;white-space:nowrap' }, timeFmt.format(new Date(it.at)) + (it.end ? '–' + timeFmt.format(new Date(it.end)) : '')),
          h('div', { class: 'item-body' }, h('div', { class: 'item-title' }, it.title), it.ev?.location ? h('div', { class: 'dim' }, it.ev.location) : null),
          h('span', { class: `pill ${it.kind === 'Deadline' ? 'warn' : it.kind === 'Event' ? 'ok' : 'info'}` }, it.kind),
          it.ev ? h('div', { class: 'item-actions' },
            h('button', { class: 'icon-btn', 'aria-label': 'Edit event', onclick: () => eventForm(it.ev, reload) }, icon('edit')),
            h('button', { class: 'icon-btn', 'aria-label': 'Delete event', onclick: () => confirmDialog(`Delete "${it.ev.title}"?`, 'This removes the event from your calendar.', async () => { await api(`/events/${it.ev.id}`, { method: 'DELETE' }); toast('Event deleted.'); reload(); }) }, icon('trash'))) : null)))))
        : emptyState('cal', 'Nothing scheduled', 'Add events, give tasks due dates, or tell JARVIS: "I have a dentist appointment tomorrow at 4pm."')),
  );
};

views.research = async (root) => {
  const r = integ('research');
  fill(root, 
    !r?.connected ? notConnected('Web research', r?.requires, 'Until it is connected, JARVIS can only answer from the language model\'s own knowledge, which may be out of date — it will label it as such and cannot provide live sources or publication dates.') : null,
    h('div', { class: 'card section-gap' }, h('h2', {}, icon('search'), 'Research workspace'),
      h('p', { class: 'muted small' }, 'Ask a research question. Without live search, answers are background knowledge only and should be verified.'),
      askBox({ placeholder: 'e.g. Summarize the key considerations for choosing a CRM for a 20-person team' })),
  );
};

views.documents = async (root) => {
  fill(root, h('div', { class: 'card' }, emptyState('file', 'Document generation — Phase 6',
    'Word, PDF, Excel and PowerPoint generation is planned for Phase 6. Today, JARVIS can draft the text of reports, proposals and meeting minutes in chat or as drafts.',
    h('a', { class: 'btn', href: '#/chat' }, icon('chat'), 'Draft in chat'))));
};

views.automations = async (root) => {
  const [list, wa] = await Promise.all([api('/automations'), Promise.resolve(integ('whatsapp'))]);
  const reload = () => route();
  const save = async (id, body) => {
    try { await api(`/automations/${id}`, { method: 'PATCH', body }); toast('Saved.'); reload(); } catch (err) { toast(err.message, 'err'); }
  };
  const runPill = (r) => r ? h('span', { class: `pill ${r.status === 'success' ? 'ok' : r.status === 'running' ? 'info' : r.status === 'partial' ? 'warn' : 'err'}` }, r.status) : null;
  fill(root,
    !wa?.connected ? h('div', { class: 'notice', style: 'margin-bottom:16px' }, icon('shield'), h('div', {},
      h('strong', {}, 'WhatsApp is not configured yet. '), 'Briefings still arrive in the JARVIS notification center; WhatsApp delivery will show as failed until you add ',
      h('code', {}, (wa?.requires || []).join(', ')), ' to .env. Guide: ', h('code', {}, 'docs/SETUP-WHATSAPP.md'), '.')) : null,
    h('div', { class: 'stack' }, list.map((a) => {
      const time = h('input', { class: 'input', type: 'time', value: a.run_at, style: 'width:130px' });
      const chk = (c, label) => h('label', { class: 'row small', style: 'gap:6px;cursor:pointer' },
        h('input', { type: 'checkbox', checked: a.channels.includes(c), 'data-ch': c }), label);
      const chans = h('div', { class: 'row' }, chk('in_app', 'In-app'), chk('whatsapp', 'WhatsApp'));
      return h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', {}, icon('auto'), a.name), h('span', { class: 'spacer' }),
          h('span', { class: `pill ${a.enabled ? 'ok' : ''}` }, a.enabled ? `on · daily ${a.run_at}` : 'off')),
        h('p', { class: 'muted small', style: 'margin-top:0' }, a.description),
        h('div', { class: 'row', style: 'gap:16px' },
          h('label', { class: 'field' }, `Time (${a.timezone})`, time),
          h('div', { class: 'field' }, 'Deliver to', chans),
          h('span', { style: 'flex:1' }),
          h('button', {
            class: 'btn', onclick: async () => {
              const { text } = await api(`/automations/${a.id}/preview`);
              openModal([h('h2', {}, icon('auto'), 'Preview'), h('div', { class: 'preview' }, text), h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: closeModal }, 'Close'))]);
            },
          }, 'Preview'),
          h('button', {
            class: 'btn', onclick: async (e) => {
              e.target.disabled = true;
              try {
                const r = await api(`/automations/${a.id}/run`, { method: 'POST' });
                toast(r.status === 'success' ? 'Sent.' : `${r.status}: ${r.error}`, r.status === 'success' ? '' : 'err');
              } catch (err) { toast(err.message, 'err'); }
              reload(); refreshChrome();
            },
          }, icon('send'), 'Send now'),
          h('button', {
            class: 'btn primary', onclick: () => {
              const channels = [...chans.querySelectorAll('input:checked')].map((i) => i.dataset.ch);
              save(a.id, { run_at: time.value, channels });
            },
          }, 'Save'),
          h('button', { class: `btn ${a.enabled ? 'danger' : ''}`, onclick: () => save(a.id, { enabled: !a.enabled }) }, a.enabled ? 'Turn off' : 'Turn on')),
        a.lastRun ? h('div', { class: 'dim', style: 'margin-top:12px' }, 'Last run: ', fmt.dt(a.lastRun.started_at), ' (', a.lastRun.trigger, ') ', runPill(a.lastRun),
          a.lastRun.error ? h('div', { class: 'small', style: 'color:var(--err);margin-top:4px' }, a.lastRun.error) : null,
          ' ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); showRuns(a); } }, 'History')) : h('div', { class: 'dim', style: 'margin-top:12px' }, 'Has not run yet.'));
    })),
    h('div', { class: 'notice info section-gap' }, icon('auto'), h('div', {},
      'Each automation runs at most once per day (also after a restart). If JARVIS was off at the scheduled time, it catches up within 3 hours. ',
      'Midday check-in, end-of-day wrap-up and weekly review are next on the roadmap.')),
  );
};

async function showRuns(a) {
  const runs = await api(`/automations/${a.id}/runs`);
  openModal([
    h('h2', {}, icon('auto'), `${a.name} — history`),
    h('table', { class: 'tbl section-gap' }, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Trigger'), h('th', {}, 'Status'))),
      h('tbody', {}, runs.map((r) => h('tr', {}, h('td', { class: 'small' }, fmt.dt(r.started_at), r.error ? h('div', { class: 'dim' }, r.error) : null), h('td', { class: 'small' }, r.trigger),
        h('td', {}, h('span', { class: `pill ${r.status === 'success' ? 'ok' : r.status === 'partial' ? 'warn' : 'err'}` }, r.status)))))),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: closeModal }, 'Close')),
  ]);
}

views.memory = async (root) => {
  const q = sessionStorage.getItem('jarvis.memQ') || '';
  const cat = sessionStorage.getItem('jarvis.memCat') || '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (cat) params.set('category', cat);
  const list = await api(`/memory?${params}`);
  const CATS = ['preference', 'writing_style', 'project', 'deadline', 'decision', 'instruction', 'contact', 'other'];
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search memory…', value: q });
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { sessionStorage.setItem('jarvis.memQ', search.value); route(); }, 300); });
  const reload = () => route();

  const memForm = (m) => {
    const c = h('select', { class: 'input' }, CATS.map((x) => h('option', { value: x, selected: (m?.category || 'preference') === x }, x.replace('_', ' '))));
    const content = h('textarea', { class: 'input', required: true, maxlength: 2000 }, m?.content || '');
    openModal(h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try { await api(m ? `/memory/${m.id}` : '/memory', { method: m ? 'PATCH' : 'POST', body: { category: c.value, content: content.value } }); closeModal(); toast('Memory saved.'); reload(); } catch (err) { toast(err.message, 'err'); }
      },
    }, h('h2', {}, icon('brain'), m ? 'Correct memory' : 'Add memory'),
    h('p', { class: 'dim' }, 'Never store passwords or API keys here — JARVIS will refuse them.'),
    h('div', { class: 'stack section-gap' }, h('label', { class: 'field' }, 'Category', c), h('label', { class: 'field' }, 'Content', content)),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
  };

  fill(root, 
    h('div', { class: 'row', style: 'margin-bottom:14px' }, h('div', { style: 'flex:1;min-width:200px' }, search),
      h('button', { class: 'btn primary', onclick: () => memForm(null) }, icon('plus'), 'Add memory')),
    h('div', { class: 'tabs' }, [['', 'All'], ...CATS.map((x) => [x, x.replace('_', ' ')])].map(([k, l]) =>
      h('button', { class: `tab${k === cat ? ' active' : ''}`, onclick: () => { sessionStorage.setItem('jarvis.memCat', k); route(); } }, l))),
    h('div', { class: 'card' },
      list.length ? h('div', { class: 'list' }, list.map((m) => h('div', { class: 'item' },
        h('div', { class: 'item-body' }, h('div', { class: 'item-title' }, m.content),
          h('div', { class: 'item-meta' }, h('span', { class: 'pill info' }, m.category.replace('_', ' ')), `saved by ${m.source}`, '·', `updated ${fmt.dt(m.updated_at)}`)),
        h('div', { class: 'item-actions' },
          h('button', { class: 'icon-btn', 'aria-label': 'Correct memory', onclick: () => memForm(m) }, icon('edit')),
          h('button', { class: 'icon-btn', 'aria-label': 'Delete memory', onclick: () => confirmDialog('Delete this memory?', m.content, async () => { await api(`/memory/${m.id}`, { method: 'DELETE' }); toast('Memory deleted.'); reload(); }) }, icon('trash'))))))
        : emptyState('brain', q || cat ? 'No matches' : 'Memory is empty', 'Tell JARVIS your preferences, writing style and project facts — or add them here. Everything stored is visible and editable.')),
  );
};

views.activity = async (root) => {
  const list = await api('/activity?limit=300');
  fill(root, h('div', { class: 'card' }, h('h2', {}, icon('pulse'), 'Activity log'),
    h('p', { class: 'dim' }, 'An append-only record of important operations. Credentials are redacted before anything is written.'),
    list.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Event'), h('th', { class: 'hide-sm' }, 'Type'))),
      h('tbody', {}, list.map((a) => h('tr', {},
        h('td', { class: 'muted small', style: 'white-space:nowrap' }, fmt.dt(a.created_at)),
        h('td', {}, a.message, a.meta?.actor ? h('span', { class: 'dim' }, ` · ${a.meta.actor}`) : null),
        h('td', { class: 'hide-sm' }, h('span', { class: `pill ${/error|failed/.test(a.type) ? 'err' : /approval/.test(a.type) ? 'warn' : ''}` }, a.type))))))
      : emptyState('pulse', 'No activity yet', 'Operations will be recorded here.')));
};

views.settings = async (root) => {
  const s = await api('/status');
  state.status = s;
  fill(root, 
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h2', {}, icon('spark'), 'AI engine'),
        h('dl', { class: 'kv', style: 'margin-top:0' },
          h('dt', {}, 'Status'), h('dd', {}, h('span', { class: `pill ${s.ai.configured ? 'ok' : 'err'}` }, s.ai.configured ? 'configured' : 'not configured')),
          h('dt', {}, 'Provider'), h('dd', {}, s.ai.label || s.ai.provider),
          h('dt', {}, 'Model'), h('dd', {}, s.ai.model || '—'),
          h('dt', {}, 'API key'), h('dd', {}, s.ai.configured ? '•••••••• (set in .env, never sent to the browser)' : h('span', { class: 'muted' }, `missing: ${s.ai.missing.join(', ')}`))),
        h('p', { class: 'dim' }, 'Change provider or model with AI_PROVIDER and AI_MODEL in .env, then restart. Configured status means the settings are present; the first chat confirms the key works.')),
      h('div', { class: 'card' }, h('h2', {}, icon('gear'), 'Workspace'),
        h('dl', { class: 'kv', style: 'margin-top:0' },
          h('dt', {}, 'Time zone'), h('dd', {}, s.timezone),
          h('dt', {}, 'Name'), h('dd', {}, s.userName || '—'),
          h('dt', {}, 'Access'), h('dd', {}, s.authRequired ? 'Token required' : 'Local only (no token)')),
        s.warnings.length ? h('div', { class: 'notice' }, icon('shield'), h('div', {}, s.warnings.join(' '))) : null,
        s.authRequired ? h('button', { class: 'btn sm', onclick: () => { setToken(''); toast('Signed out of this session.'); askForToken(); } }, 'Forget access token') : null)),
    h('div', { class: 'card section-gap' }, h('h2', {}, icon('shield'), 'Integrations'),
      h('p', { class: 'dim' }, 'Each integration is an independent module. Only those marked online are used; JARVIS never pretends a service is connected.'),
      h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Integration'), h('th', {}, 'Status'), h('th', { class: 'hide-sm' }, 'Needs'))),
        h('tbody', {}, s.integrations.map((i) => h('tr', {},
          h('td', {}, h('div', { class: 'item-title' }, i.name), h('div', { class: 'dim' }, i.description)),
          h('td', {}, h('span', { class: `pill ${i.connected ? 'ok' : i.status === 'not_configured' ? 'err' : ''}` }, i.connected ? 'online' : i.status === 'not_implemented' ? `planned · phase ${i.phase}` : i.status === 'needs_authorization' ? 'connect' : 'needs config')),
          h('td', { class: 'hide-sm small muted' }, i.account ? h('div', {}, i.account) : null, i.requires.join(', ') || (i.account ? '' : '—'),
            i.id === 'email' && i.connected ? h('div', { style: 'margin-top:6px' }, h('button', {
              class: 'btn sm danger', onclick: () => confirmDialog('Disconnect Gmail?', 'JARVIS will revoke its Google access and delete the stored token. Your email is not affected.', async () => { await api('/integrations/google/disconnect', { method: 'POST' }); toast('Gmail disconnected.'); refreshAll(); }, 'Disconnect'),
            }, 'Disconnect')) : null,
            i.id === 'whatsapp' && i.connected ? h('div', { style: 'margin-top:6px' }, h('button', {
              class: 'btn sm', onclick: async (e) => { e.target.disabled = true; try { await api('/integrations/whatsapp/test', { method: 'POST' }); toast('Test message sent to your WhatsApp.'); } catch (err) { toast(err.message, 'err'); } e.target.disabled = false; },
            }, 'Send test message')) : null)))))),
  );
};

// ───────────────────────── router ─────────────────────────
let routeToken = 0;
async function route() {
  const [, name = 'home', sub] = (location.hash || '#/home').split('?')[0].split('/');
  if (name === 'approvals' && sub) { showApproval(sub).catch((e) => toast(e.message, 'err')); location.hash = '#/home'; return; }
  const view = views[name] ? name : 'home';
  renderNav(view);
  const label = NAV.find((n) => n[0] === view)[1];
  $('#view-title').textContent = label;
  document.title = view === 'home' ? 'J.A.R.V.I.S' : `${label} · J.A.R.V.I.S`;
  const root = $('#view');
  const my = ++routeToken;
  fill(root, loading());
  try {
    if (!state.status) await refreshChrome();
    const tmp = h('div');
    await views[view](tmp);
    if (my !== routeToken) return;
    fill(root, ...tmp.childNodes);
  } catch (err) {
    if (my !== routeToken) return;
    fill(root, h('div', { class: 'card' }, emptyState('shield', 'Could not load this view', err.message, h('button', { class: 'btn', onclick: route }, 'Retry'))));
  }
}

function refreshAll() { refreshChrome(); route(); }

window.addEventListener('hashchange', route);
$('#menu-btn').addEventListener('click', () => toggleSidebar(true));
$('#scrim').addEventListener('click', () => toggleSidebar(false));
$('#notif-btn').addEventListener('click', () => ($('#drawer').hidden ? openDrawer() : closeDrawer()));
$('#approvals-btn').addEventListener('click', showApprovalsList);

refreshChrome().then(route);
let lastUnread = null;
setInterval(async () => {
  await refreshChrome();
  const un = state.status?.counts.unreadNotifications;
  if (lastUnread != null && un > lastUnread) toast('New notification — check the bell.');
  lastUnread = un;
}, 20_000);
