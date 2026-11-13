# J.A.R.V.I.S — Personal AI Command Center

A modular, self-hosted personal AI assistant: a dark command-center dashboard, a conversational engine that can act (via tool calling) on your tasks, reminders, memory and drafts, and a strict **approval gate** for anything sensitive.

> **Status:** dashboard, AI chat, memory, tasks, reminders, approvals, **built-in calendar**, **Gmail** (OAuth), **WhatsApp notifications** and the **automation engine** (nightly "tomorrow's schedule") are implemented. Web research, file storage, document generation and messaging other people are **not built yet** — the UI says so explicitly and JARVIS never invents data from them.

## What works today

| Area | Capability |
|---|---|
| **Dashboard** | Home briefing (Emails / Calendar / Tasks / Intelligence), Ask JARVIS box, Top 3, workload chart, reminders, system status, recent activity. Desktop, tablet and mobile layouts. |
| **AI chat** | Natural-language assistant with persistent conversations, tool calling, voice dictation (browser speech-to-text), provider-agnostic (Groq, OpenAI, or any OpenAI-compatible server such as Ollama). |
| **Today** | Tasks organized into **Top 3 / Important / Routine / Upcoming** with a reason for each, overdue warnings, one-click "Generate briefing". |
| **Tasks & reminders** | Full create/edit/complete/cancel; reminders fire in the background (exactly once) into the notification center. |
| **Memory** | Long-term, searchable, categorized memory (preferences, writing style, projects, deadlines, decisions…). View, correct, delete. **Refuses credentials.** Kept separate from conversation history. |
| **Calendar** | Built-in calendar: add events in the app or by chat ("dentist tomorrow at 4pm"). Next-3-weeks agenda with events, deadlines and reminders. |
| **Bedtime briefing** | Every night (default 21:30 in your time zone) JARVIS sends tomorrow's events, deadlines, reminders and top priorities — in-app and to your WhatsApp. If nothing is planned, it asks you to plan tomorrow. Configurable time/channels, on/off, run history, once-per-day guarantee. |
| **Reports** | **Midday check-in** (weekdays 13:00): done vs pending, delays, 48-hour deadlines, problems, new important email, schedule changes, suggested order for the rest of the day. **End-of-day wrap-up** (weekdays 18:30): the 8-part daily report plus a manager status update saved as a draft. **Weekly review** (Fridays 17:30): achievements, projects, blockers, deadlines, decisions, next week's priorities, organization suggestions. Built from your data — they never change, remove or send anything. Generate any time from the Reports page or by asking JARVIS. |
| **Documents** | Create **Word (.docx), PDF, PowerPoint (.pptx) and Excel (.xlsx)** files — from the Documents page, by asking JARVIS ("turn these notes into a 6-slide deck"), or by exporting any report as PDF/Word. Content is written in simple Markdown (Excel: rows/CSV with real numbers and formulas). Built locally with no external service or library; files stay on your machine until you download them. PDF uses standard fonts, so non-Latin scripts (e.g. Hindi) need Word instead. |
| **Gmail** | Connect with Google sign-in; inbox/unread/important views, read messages, "Summarize with JARVIS", "Draft reply". Sending only after approval. Setup: [docs/SETUP-GMAIL.md](docs/SETUP-GMAIL.md). |
| **WhatsApp** | Notifications to your own number via Meta WhatsApp Cloud API. Setup: [docs/SETUP-WHATSAPP.md](docs/SETUP-WHATSAPP.md). |
| **Drafts** | Emails, messages and status updates saved as drafts for review. Never sent automatically. |
| **Approvals** | Sending, and the assistant's delete requests, create an approval card (action, target, content, **Confirm / Cancel**). Results report what really happened. |
| **Activity log** | Append-only record of important operations, with secrets redacted. |
| **Settings** | AI engine and per-integration connection status, with no secret ever sent to the browser. |

## Quick start

Requires **Node.js 22.5+** (uses the built-in `node:sqlite`). There are **no npm dependencies**.

```bash
cp .env.example .env        # then edit .env — add your AI key
npm run check-config        # validates config without printing secrets
npm start                   # http://127.0.0.1:3000
npm test                    # 41 tests: services, approvals, engine, integrations, automations, reports, documents, HTTP
```

Minimum `.env` for Groq:

```env
AI_PROVIDER=groq
GROQ_API_KEY=your-key-here
JARVIS_TIMEZONE=Asia/Kolkata   # IANA time zone (India)
JARVIS_USER_NAME=YourName
```

Other providers: `AI_PROVIDER=openai` + `OPENAI_API_KEY`, or `AI_PROVIDER=openai_compatible` + `AI_BASE_URL` (e.g. `http://localhost:11434/v1` for Ollama) + `AI_MODEL`. Change the model with `AI_MODEL`. The model must support tool/function calling.

### Running on a network / phone access
JARVIS binds to `127.0.0.1` by default. To reach it from other devices, set `JARVIS_HOST=0.0.0.0` **and** `JARVIS_ACCESS_TOKEN` (32+ random chars). JARVIS refuses to start on a non-loopback address without a token. Put it behind HTTPS (e.g. Caddy, nginx, or Tailscale) before using it over the internet.

## Architecture

```
public/                 Frontend — vanilla ES modules, no build step
  index.html  styles.css  app.js
server/
  index.js              Entry point (config → app → HTTP)
  config.js             Env loading, validation, redacted public status
  app.js                Composition root; registers approval executors
  db.js                 SQLite schema + forward-only migrations
  http/                 node:http server, router, REST API, auth, CSP
  ai/
    provider.js         Provider abstraction (OpenAI-compatible client)
    engine.js           System prompt, memory retrieval, tool-calling loop
    tools.js            Tool schemas + handlers (the assistant's "hands")
  services/             tasks, reminders, memory, drafts, approvals, reports,
                        conversations, notifications, activity
  automations/
    engine.js           Scheduler: daily workflows, history, de-duplication
  documents/            Dependency-free generators: zip, markdown, docx, pdf, pptx, xlsx
  integrations/
    registry.js         Honest status reporting for every integration
    google.js           Gmail via OAuth 2.0 (read + approved send)
    whatsapp.js         WhatsApp Cloud API (owner-only notifications)
  lib/                  secrets redaction, time-zone helpers
tests/                  node:test suites (scripted model for engine tests)
```

**Separation of concerns.** The AI engine, integrations and interface are independent: swap providers by changing `.env`; add an integration by adding a module and registry entry; redesign the UI without touching the backend (everything goes through `/api`).

**How a chat turn works.** User message → engine builds a system prompt (current time in your time zone, rules, relevant memories) + conversation history → model → if it calls tools, they run against the services and results go back to the model → repeat (max 6 rounds) → final reply + a list of actions taken (shown as chips in chat).

**Approval gate.** The model has no tool that deletes or sends. It only has `request_*` tools that create a pending approval. Execution happens exclusively in executors registered in `server/app.js`, triggered by the user's **Confirm**. Confirm is atomic (no double execution). If an integration isn't connected, the executor fails honestly and keeps the draft.

## Security

- Secrets only in `.env` (git-ignored); never sent to the frontend, never logged. Activity log, approvals and tool results pass through a redactor (`server/lib/secrets.js`).
- Memory rejects anything that looks like a password, API key, token or private key.
- Optional bearer-token auth (constant-time compare); required for non-loopback binding.
- Strict Content-Security-Policy (no inline scripts), `X-Frame-Options: DENY`, no-referrer, cross-origin write requests blocked, 1 MB body limit, path-traversal-safe static serving, input validation on every endpoint.
- Email content is treated as untrusted: the model is told never to follow instructions inside emails, and it has no tool that sends without approval.
- Google OAuth uses a one-time, expiring `state` (CSRF protection); the refresh token stays in the local DB. Outgoing email rejects header injection.
- WhatsApp can only message `WHATSAPP_NOTIFY_TO` — there is no code path to message anyone else.
- JARVIS never makes purchases or financial transactions — there is no tool for it.

## Roadmap

| Phase | Feature | Status |
|---|---|---|
| 1 | Dashboard & AI chat | ✅ Done |
| 2 | AI model & API connection (Groq / OpenAI / compatible) | ✅ Done |
| 3 | Memory & context | ✅ Done |
| 4 | Gmail (read, summarize, approved send) | ✅ Done — needs your Google OAuth client |
| 4 | Built-in calendar | ✅ Done |
| 5 | Tasks & reminders | ✅ Done |
| 5 | WhatsApp notifications (to you) | ✅ Done — needs Meta WhatsApp Cloud API setup |
| 7 | Automations: bedtime schedule, morning schedule (off by default), midday check-in, end-of-day wrap-up, weekly review | ✅ Done |
| 5 | Web research with citations | ⏳ Needs a search API (e.g. Tavily, Brave) |
| 6 | Document generation (Word / PDF / PowerPoint / Excel) | ✅ Done |
| — | Messaging other people (with approval) | ⏳ Planned |
| 8 | Advanced voice assistant | Later |
