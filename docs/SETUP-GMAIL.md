# Connect Gmail to JARVIS

JARVIS reads your inbox and, **only after you click Confirm on an approval card**, sends replies. It uses Google's official OAuth sign-in, so JARVIS never sees your Google password.

Scopes requested (least privilege for these features):
- `gmail.readonly` — list and read messages
- `gmail.send` — send a message you approved

## 1. Create a Google Cloud project (one time, ~10 minutes)
1. Go to <https://console.cloud.google.com/> and sign in with the Gmail account you want JARVIS to use.
2. Create a project (e.g. "JARVIS").
3. **APIs & Services → Library** → search **Gmail API** → **Enable**.

## 2. Configure the consent screen
1. **APIs & Services → OAuth consent screen** (or "Google Auth Platform → Branding").
2. User type: **External**. App name: `JARVIS`. Add your email as support and developer contact.
3. **Audience / Test users** → add your own Gmail address.
   - While the app is in *Testing*, only test users can sign in and Google expires the refresh token after **7 days** — you'd reconnect weekly. To avoid that, click **Publish app** (for personal use you can proceed past the "unverified app" warning yourself).

## 3. Create OAuth credentials
1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized redirect URIs** → add exactly:
   ```
   http://127.0.0.1:3000/api/integrations/google/callback
   ```
   (If you changed `JARVIS_PORT` or host, use that, and set the same value as `GOOGLE_REDIRECT_URI` in `.env`.)
4. Copy the **Client ID** and **Client secret**.

## 4. Add them to `.env`
```env
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
```
Restart JARVIS (`npm start`).

## 5. Connect
Open JARVIS → **Email** → **Connect Gmail** → choose your account → allow. You'll land back on the Email page with your inbox.

Disconnect any time from **Settings → Integrations → Disconnect** (this revokes JARVIS's access with Google and deletes the stored token). You can also revoke it at <https://myaccount.google.com/permissions>.

## Where the token lives
The refresh token is stored in the local SQLite database (`data/jarvis.db`, git-ignored). It is never sent to the browser or written to logs. Protect that file like a password.
