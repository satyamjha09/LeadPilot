# Production Google OAuth Runbook

LeadPilot uses two independent Google sender accounts. Business brand selection and Google sender ownership are separate. Switching the Active Account in the UI does not connect, disconnect, refresh, revoke, send email, create Calendar events, update Sheets, or process sources.

## Accounts

### TallyKonnect

- Sender account key: `tallykonnect-google`
- Expected Gmail: `demo.tallykonnect@gmail.com`
- Required env:
  - `GOOGLE_TALLYKONNECT_CLIENT_ID`
  - `GOOGLE_TALLYKONNECT_CLIENT_SECRET`
  - `GOOGLE_TALLYKONNECT_REDIRECT_URI`
  - `GOOGLE_TALLYKONNECT_AUTH_EMAIL=demo.tallykonnect@gmail.com`

### AnyWhereTally

- Sender account key: `anywheretally-google`
- Expected Gmail: `info.anywheretally@gmail.com`
- Required env:
  - `GOOGLE_ANYWHERETALLY_CLIENT_ID`
  - `GOOGLE_ANYWHERETALLY_CLIENT_SECRET`
  - `GOOGLE_ANYWHERETALLY_REDIRECT_URI`
  - `GOOGLE_ANYWHERETALLY_AUTH_EMAIL=info.anywheretally@gmail.com`

## Google Cloud Setup

For each OAuth web client, configure:

- Authorized JavaScript origin: `https://mayakrishnatechnologies.in`
- Authorized redirect URI: `https://mayakrishnatechnologies.in/api/auth/callback/google`

Enable the APIs used by LeadPilot:

- Gmail API
- Google Calendar API
- Google Sheets API
- Google identity/userinfo support through OAuth scopes

Required OAuth scopes:

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/spreadsheets`

Do not put client secrets, refresh tokens, authorization codes, or access tokens in documentation, Git, screenshots, or chat.

## Testing Mode

If the Google OAuth app is still in Testing mode, only added test users can authorize the app. Add both expected Gmail accounts as test users in the exact Google Cloud project that owns the OAuth client being used.

Testing mode can also cause refresh tokens to expire or become invalid. LeadPilot should show `Reconnect required` instead of treating that as an operator login failure.

Publishing the website on a VPS is separate from publishing/verifying the Google OAuth consent screen.

## Connect and Reconnect

Use Connect when no valid Google token exists.

Use Reconnect when Google returns `invalid_grant`, the token was revoked, permissions changed, or the operator deliberately replaces credentials. A failed reconnect must not delete a still-valid previous credential.

Before Google opens, LeadPilot shows the expected Gmail address. Choose that exact account in Google. If the wrong Gmail is selected, LeadPilot rejects the callback and does not persist the mismatched token.

## Verification

Run safe diagnostics on the VPS:

```bash
npm run google:doctor
```

This command prints yes/no configuration and connection status. It does not print secrets or tokens, and it does not send email, create Calendar events, or update Sheets.

## Manual QA

### TallyKonnect

1. Log into LeadPilot.
2. Select TallyKonnect.
3. Click Connect or Reconnect.
4. Confirm the expected email is `demo.tallykonnect@gmail.com`.
5. Complete OAuth with that account.
6. Confirm status shows connected and verified.
7. Click Verify.
8. Confirm Gmail, Calendar, and Sheets capabilities are ready.

### AnyWhereTally

1. Select AnyWhereTally.
2. Click Connect or Reconnect.
3. Confirm the expected email is `info.anywheretally@gmail.com`.
4. Complete OAuth with that account.
5. Confirm status shows connected and verified.
6. Click Verify.
7. Confirm Gmail, Calendar, and Sheets capabilities are ready.

### Independence

1. Confirm both accounts can remain connected simultaneously.
2. Disconnect TallyKonnect.
3. Confirm AnyWhereTally remains connected.
4. Reconnect TallyKonnect.
5. Confirm AnyWhereTally remains connected.

### Mismatch Protection

1. Start TallyKonnect connect.
2. Select `info.anywheretally@gmail.com` in Google.
3. Confirm mismatch is rejected.
4. Confirm no TallyKonnect credentials are overwritten.
5. Confirm AnyWhereTally remains intact.

## Deployment Verification

Use this deployment flow:

```bash
git pull --ff-only origin main
npm ci
npm run db:deploy
npm run build
pm2 restart leadpilot-web --update-env
pm2 restart leadpilot-worker --update-env
pm2 save
npm run google:doctor
```

Cloudflare R2 and production Excel storage are outside this Phase 14 OAuth runbook.
