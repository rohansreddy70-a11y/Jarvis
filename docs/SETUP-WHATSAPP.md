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
