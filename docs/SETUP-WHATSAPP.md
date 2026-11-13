# WhatsApp notifications for JARVIS

JARVIS sends **your own** briefings (e.g. the nightly "tomorrow's schedule") to **your own** WhatsApp number. It cannot message anyone else.

It uses Meta's official **WhatsApp Cloud API**. Personal WhatsApp accounts have no official API, so you need a (free) WhatsApp Business sender number from Meta. The message is sent *from* that business number *to* your personal number.

## 1. Create the Meta app (~15 minutes)
1. Go to <https://developers.facebook.com/apps> → **Create app** → use case **Other** → type **Business**.
2. Add the **WhatsApp** product to the app.
3. In **WhatsApp → API Setup** Meta gives you a free **test phone number**. Note the **Phone number ID**.
4. Under **To**, add **your personal WhatsApp number** as a recipient and verify it with the code Meta sends you.

## 2. Get a permanent access token
The token on the API Setup page expires in 24 hours. For a permanent one:
1. **Business Settings → Users → System users** → **Add** (role Admin).
2. **Assign assets** → your app → full control.
3. **Generate token** → select your app → permissions `whatsapp_business_messaging` and `whatsapp_business_management` → expiry **Never**.

## 3. Create a message template (needed for nightly delivery)
WhatsApp only lets a business send free-form text within **24 hours** of your last message *to* it. A nightly briefing is usually outside that window, so it must use an **approved template**.

1. **WhatsApp Manager → Message templates → Create template**.
2. Category **Utility**, name `jarvis_briefing`, language **English**.
3. Body:
   ```
   JARVIS update: {{1}}
   ```
   (Give a sample value, e.g. "Tomorrow: 10:00 Team sync".)
4. Submit. Approval usually takes minutes.

JARVIS puts the whole briefing into `{{1}}` on one line (sections separated by `|`), because WhatsApp doesn't allow line breaks inside template variables.

## 4. Add to `.env`
```env
WHATSAPP_TOKEN=EAAG...              # permanent system-user token
WHATSAPP_PHONE_NUMBER_ID=1234567890 # from API Setup
WHATSAPP_NOTIFY_TO=91XXXXXXXXXX     # your number: country code + number, digits only
WHATSAPP_TEMPLATE_NAME=jarvis_briefing
WHATSAPP_TEMPLATE_LANG=en
```
Restart JARVIS, then **Settings → Integrations → WhatsApp → Send test message**.

## Troubleshooting
| Error | Fix |
|---|---|
| "outside the 24-hour window" | Set `WHATSAPP_TEMPLATE_NAME`, or send any message to the business number first. |
| "Recipient phone number not in allowed list" | Add and verify your number under **API Setup → To** (test numbers only). |
| "Invalid OAuth access token" | The token expired; generate a permanent system-user token. |

Every delivery attempt shows on **Automations → History**. Failures also appear in the JARVIS notification center, and the in-app copy of the briefing is still delivered.

---

# Part 2 — Talk to JARVIS on WhatsApp (two-way bot)

With Part 1 done, JARVIS can *send* you messages. Part 2 lets you *message JARVIS* — text or voice notes — and it replies using all its functions (tasks, reminders, calendar, email drafts, reports, documents…).

**How it stays safe**
- JARVIS answers **only `WHATSAPP_NOTIFY_TO`** (your number). Messages from anyone else are logged as ignored and never answered.
- Every incoming request must carry Meta's **HMAC signature** (made with your App Secret). Forged requests are rejected.
- Sending email and deleting anything still needs approval. By default you approve **in the JARVIS app**. To allow approving from WhatsApp, set `WHATSAPP_ALLOW_APPROVALS=true` — JARVIS then shows the full action and only acts on an exact `APPROVE <id>` reply.
- Voice notes are transcribed with your AI provider's speech-to-text (Groq Whisper or OpenAI Whisper — same API key).

## 1. Give JARVIS a public https address
Meta must be able to reach JARVIS. The simplest free option is a **Cloudflare quick tunnel**:

```bash
# 1. FIRST set an access token, because the tunnel makes the app reachable from the internet:
#    JARVIS_ACCESS_TOKEN=<long random string>   (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# 2. Start JARVIS
npm start
# 3. In another terminal (install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
cloudflared tunnel --url http://127.0.0.1:3000
```
It prints an address like `https://random-words.trycloudflare.com`. Quick-tunnel addresses change every time you restart `cloudflared`; for a permanent address create a named Cloudflare Tunnel (free) or run JARVIS on a small server. `ngrok http 3000` works too.

> Opening that address in your phone's browser also gives you the full JARVIS app — including the **Voice** page (the microphone requires https, which the tunnel provides). You'll be asked for the access token.

## 2. Add the bot settings to `.env`
```env
WHATSAPP_APP_SECRET=xxxxxxxx      # Meta app → App settings → Basic → App secret
WHATSAPP_VERIFY_TOKEN=any-long-random-string-you-choose
WHATSAPP_ALLOW_APPROVALS=false     # true = allow "APPROVE <id>" replies from WhatsApp
```
Restart JARVIS.

## 3. Register the webhook with Meta
1. Meta app → **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL:** `https://<your-tunnel-address>/api/integrations/whatsapp/webhook`
3. **Verify token:** the same value as `WHATSAPP_VERIFY_TOKEN`.
4. Click **Verify and save** (JARVIS answers Meta's check automatically).
5. Under **Webhook fields**, **Subscribe** to `messages`.

## 4. Say hello
From your phone, send **"help"** to the business number. Try:
- "What are my priorities today?"
- 🎙️ a voice note: "Remind me to call the bank tomorrow at 11"
- "What's on my schedule tomorrow?"
- "Give me my end-of-day wrap-up"
- "Make an Excel tracker of my open tasks"

Commands: `new` (fresh conversation), `pending` (approvals waiting), `help`.

Messages and their status appear in **JARVIS → Settings → WhatsApp bot**.

| Problem | Fix |
|---|---|
| Meta says verification failed | The tunnel must be running, the URL must end in `/api/integrations/whatsapp/webhook`, and the verify token must match exactly. |
| No reply | Check **Settings → WhatsApp bot** and **Activity**. "Rejected … invalid signature" means `WHATSAPP_APP_SECRET` is wrong. |
| "Voice notes need…" | Voice notes require `AI_PROVIDER=groq` or `openai`. |
