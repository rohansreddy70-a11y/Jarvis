# J.A.R.V.I.S — Personal AI Command Center

A modular, self-hosted personal AI assistant: a dark command-center dashboard, a conversational engine that can act (via tool calling) on your tasks, reminders, memory and drafts, and a strict **approval gate** for anything sensitive.

> **Status: Phases 1–3 + task/reminder core are implemented.** Email, calendar, messaging, web research, file storage, document generation and scheduled automations are designed for but **not connected yet** — the UI says so explicitly and JARVIS never invents data from them.

## What works today

| Area | Capability |
|---|---|
| **Dashboard** | Home briefing (Emails / Calendar / Tasks / Intelligence), Ask JARVIS box, Top 3, workload chart, reminders, system status, recent activity. Desktop, tablet and mobile layouts. |
| **AI chat** | Natural-language assistant with persistent conversations, tool calling, voice dictation (browser speech-to-text), provider-agnostic (Groq, OpenAI, or any OpenAI-compatible server such as Ollama). |
| **Today** | Tasks organized into **Top 3 / Important / Routine / Upcoming** with a reason for each, overdue warnings, one-click "Generate briefing". |
| **Tasks & reminders** | Full create/edit/complete/cancel; reminders fire in the background (exactly once) into the notification center. |
| **Memory** | Long-term, searchable, categorized memory (preferences, writing style, projects, deadlines, decisions…). View, correct, delete. **Refuses credentials.** Kept separate from conversation history. |
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
npm test                    # 18 tests: services, approvals, engine, HTTP, config
```

Minimum `.env` for Groq:

```env
AI_PROVIDER=groq
GROQ_API_KEY=your-key-here
JARVIS_TIMEZONE=Asia/Kolkata   # your IANA time zone
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
  services/             tasks, reminders, memory, drafts, approvals,
                        conversations, notifications, activity
  integrations/
    registry.js         Integration modules + honest status reporting
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
- JARVIS never makes purchases or financial transactions — there is no tool for it.

## Roadmap

| Phase | Feature | Status |
|---|---|---|
| 1 | Dashboard & AI chat | ✅ Done |
| 2 | AI model & API connection (Groq / OpenAI / compatible) | ✅ Done |
| 3 | Memory & context | ✅ Done |
| 5 | Task manager & reminders | ✅ Done (core) |
| 4/5 | Email & calendar (Gmail / Microsoft 365 via OAuth) | ⏳ Needs your provider choice + OAuth app |
| 5 | Web research with citations | ⏳ Needs a search API (e.g. Tavily, Brave) |
| 6 | Document generation (DOCX / PDF / XLSX / PPTX) | ⏳ Planned |
| 7 | Automations: morning briefing, midday check-in, wrap-up, weekly review | ⏳ Planned (scheduler, enable/disable, history, de-dup) |
| 8 | Advanced voice assistant | Later |

## Decisions needed from you

1. **Email & calendar provider** — Google Workspace or Microsoft 365? (Determines the OAuth setup.)
2. **Web research API** — Tavily, Brave Search, or another?
3. **Your time zone** and preferred **briefing times** (morning / midday / end of day / weekly).
4. **Where it runs** — your laptop only, or a server reachable from your phone?
5. **Messaging** — Slack, Microsoft Teams, WhatsApp, or none?
