# LeadPilot - Excel & Google Sheet Meet Scheduler

LeadPilot imports leads from Excel or Google Sheets, creates Google Calendar meetings with Google Meet links, sends Gmail templates, updates the source sheet, and prevents duplicate emails using PostgreSQL state.

The current production setup supports two brands:

- **TallyKonnect** using `demo.tallykonnect@gmail.com`
- **AnyWhereTally** using `info.anywheretally@gmail.com`

The workflow stays the same for both brands. The selected brand changes the sender account, logo, company name, website, contact email, calendar copy, and email template content.

## Current Status

Final application behavior matches the intended workflow:

- Excel import uses multipart upload with `multer`.
- Google Sheet import reads directly from Google Sheets.
- Google OAuth tokens are stored in PostgreSQL via Prisma, not local token files.
- Processing preview shows total, skipped, new scheduled emails, reschedules, demo-done emails, invalid rows, and time conflicts.
- Background processing uses BullMQ + Redis when `PROCESS_QUEUE_ENABLED=true`.
- Duplicate prevention uses `automation_id`, `LeadSchedule`, `CustomerDemoState`, `DemoHistory`, and `EmailDelivery`.
- Old Demo Scheduled rows with existing Meet links are skipped.
- `Reschedule` rows are processed even when an old Meet link exists.
- AnyWhereTally has all three main templates:
  - Demo Scheduled
  - Demo Done / Thank You
  - Reschedule Demo

## Main Workflow

1. User imports an Excel file or Google Sheet URL.
2. App normalizes rows and lead statuses.
3. App restores missing `automation_id` from PostgreSQL when possible.
4. User selects rows and clicks Process Leads.
5. Preview dialog shows what will happen before sending.
6. User selects brand: TallyKonnect or AnyWhereTally.
7. Backend processes only actionable rows.
8. App creates/updates Google Calendar events and Google Meet links.
9. App sends the correct email template from the correct Google account.
10. Google Sheet rows are updated directly, or Excel results can be exported.

## Supported Lead Statuses

Recommended values:

- `Demo Scheduled`
- `Reschedule`
- `Demo Done`
- `Not Attended`
- `Follow Up`
- `To be called`
- `not required`
- `Repeated`

Notes:

- `No Response` is accepted as an alias, but the app normalizes it to `Not Attended`.
- `Demo Scheduled` creates a meeting and sends the scheduled-demo email.
- `Reschedule` updates the existing calendar event and sends the reschedule email.
- `Demo Done` sends the thank-you/demo-done email.
- `Not Attended` sends the not-attended email.
- Status-only rows do not create a new meeting.

## Required Sheet Columns

The app supports flexible header names, but these are recommended:

- `full_name`
- `email`
- `Date of Demo`
- `Time of Demo`
- `Meeting Details`
- `lead_status`
- `Remarks`
- `automation_id`

Google Sheet processing updates:

- `Meeting Details`
- `lead_status`
- `Remarks`
- `automation_id`

## Duplicate Prevention

The duplicate-safety design depends on stable lead identity.

Important rules:

- `automation_id` is treated like a permanent ID for each lead row.
- If a Google Sheet row loses its `automation_id`, the app tries to restore it from PostgreSQL.
- Existing Demo Scheduled rows with a Google Meet link are skipped.
- Existing email deliveries are checked before Gmail sends again.
- Failed rows can be retried safely.
- `Reschedule` is intentionally not skipped because it means update date/time and notify the customer.

Database tables involved:

- `LeadSchedule`
- `CustomerDemoState`
- `DemoHistory`
- `EmailDelivery`
- `SheetLeadState`
- `SheetSyncJob`
- `GoogleAuth`
- `ProcessLeadJob`

## Brand & Email Account Behavior

Brand selection is made in the process preview dialog before final processing.

### TallyKonnect

- Sender/auth email: `demo.tallykonnect@gmail.com`
- Website: `https://tallykonnect.com`
- Logo: `public/images/logo.png`
- Demo focus: Smart TDS / TallyKonnect

### AnyWhereTally

- Sender/auth email: `info.anywheretally@gmail.com`
- Website: `https://anywheretally.com`
- Logo: `public/images/anywheretally.png`
- Demo focus: Tally Mobile App / AnyWhereTally

AnyWhereTally templates present in code:

- `buildAnyWhereTallyScheduledHtml`
- `buildAnyWhereTallyThankYouHtml`
- `buildAnyWhereTallyRescheduleHtml`

These are used by:

- `buildMeetingInviteEmail`
- `buildThankYouEmail`
- `buildRescheduleEmail`

The lead workflow passes `emailBrand` into Calendar, Gmail, Google Sheets, queued jobs, and manual processing paths.

## Local Setup

Install dependencies:

```bash
npm install
```

Create `.env` from `.env.example`:

```bash
copy .env.example .env
```

Fill in local values:

```env
APP_URL=http://localhost:3000

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback/google
GOOGLE_AUTH_EMAIL=demo.tallykonnect@gmail.com
GMAIL_FROM_EMAIL=demo.tallykonnect@gmail.com
GMAIL_FROM_NAME=TallyKonnect

GOOGLE_ANYWHERETALLY_CLIENT_ID=
GOOGLE_ANYWHERETALLY_CLIENT_SECRET=
GOOGLE_ANYWHERETALLY_REDIRECT_URI=http://localhost:3000/api/auth/callback/google
GOOGLE_ANYWHERETALLY_AUTH_EMAIL=info.anywheretally@gmail.com
GMAIL_ANYWHERETALLY_FROM_EMAIL=info.anywheretally@gmail.com

DATABASE_URL="postgresql://postgres:your_password@localhost:5432/leadpilot_dev?schema=public"

PROCESS_QUEUE_ENABLED=false
PROCESS_QUEUE_CONCURRENCY=1
REDIS_URL=redis://localhost:6379
```

Run database migrations:

```bash
npm run db:migrate
```

Start local development:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Google Cloud Setup

Enable these APIs in Google Cloud:

- Google Calendar API
- Gmail API
- Google Sheets API

Required OAuth scopes:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/spreadsheets`

Local redirect URI:

```text
http://localhost:3000/api/auth/callback/google
```

VPS redirect URI:

```text
http://YOUR_SERVER_IP/api/auth/callback/google
```

For the current IP-only VPS deployment, the redirect URI is:

```text
http://200.97.174.49/api/auth/callback/google
```

Important:

- Add the redirect URI to both OAuth clients if both brands use separate Google OAuth clients.
- After changing scopes or redirect URIs, reconnect Google from the app.
- AnyWhereTally must be connected separately while the AnyWhereTally brand is selected.
- The selected Google account must have edit access to the Google Sheet.

## Running With BullMQ

For small local testing, queue mode can stay disabled:

```env
PROCESS_QUEUE_ENABLED=false
```

For production/background processing:

```env
PROCESS_QUEUE_ENABLED=true
PROCESS_QUEUE_CONCURRENCY=1
REDIS_URL=redis://127.0.0.1:6379
```

Run web server:

```bash
npm start
```

Run worker:

```bash
npm run worker:process-leads
```

Queue flow:

1. Frontend calls `POST /api/process-leads/jobs`.
2. Backend stores `ProcessLeadJob` in PostgreSQL.
3. Backend enqueues the job in Redis/BullMQ.
4. Worker processes rows in the background.
5. Frontend polls `GET /api/process-leads/jobs/:jobId`.

## Production Build

Build the app:

```bash
npm run build
```

Run migrations:

```bash
npm run db:deploy
```

Start server:

```bash
npm start
```

## Hostinger VPS Deployment

Current production style:

- Ubuntu 24.04
- Node.js 22
- PostgreSQL
- Redis
- Nginx reverse proxy
- PM2 for web + worker

Typical app path:

```text
/var/www/leadpilot
```

PM2 process names:

```text
leadpilot-web
leadpilot-worker
```

Useful commands:

```bash
pm2 status
pm2 logs leadpilot-web
pm2 logs leadpilot-worker
systemctl status nginx
systemctl status postgresql
systemctl status redis-server
```

Deploy latest `main` on VPS:

```bash
cd /var/www/leadpilot
git fetch origin main
git reset --hard origin/main
npm ci
npm run db:deploy
npm run build
pm2 restart leadpilot-web --update-env
pm2 restart leadpilot-worker --update-env
pm2 save
```

Health check:

```text
http://YOUR_SERVER_IP/api/health
```

## API Overview

Core endpoints:

- `GET /api/health`
- `GET /api/auth/status?brand=tallykonnect`
- `GET /api/auth/status?brand=anywheretally`
- `POST /api/auth/clear`
- `GET /api/auth/callback/google`
- `POST /api/preview`
- `POST /api/sheets/import`
- `POST /api/sheets/sync`
- `POST /api/process-leads/preview`
- `POST /api/process-leads`
- `POST /api/process-leads/jobs`
- `GET /api/process-leads/jobs/:jobId`
- `POST /api/reconcile`
- `POST /api/export`

Manual review/retry endpoints:

- `POST /api/email-deliveries/:deliveryId/retry`
- `POST /api/email-deliveries/:deliveryId/mark-sent`
- `POST /api/email-deliveries/:deliveryId/mark-failed`
- `POST /api/sheet-sync/jobs/:jobId/retry`

## Important Safety Notes

- Never commit `.env`.
- Never commit Google OAuth client secrets or refresh tokens.
- Rotate secrets if they are exposed in chat, screenshots, logs, or commits.
- Use HTTPS and a domain before wider production use.
- Keep queue concurrency at `1` unless Gmail/Calendar quota behavior is fully tested.
- Make database backups before production data migrations.

## Verification Commands

Run TypeScript checks:

```bash
npm run lint
```

Run production build:

```bash
npm run build
```

Check git state:

```bash
git status --short --branch
```

## Final Functional Checklist

- TallyKonnect scheduled-demo email works.
- TallyKonnect demo-done email works.
- TallyKonnect reschedule email works.
- AnyWhereTally scheduled-demo email template exists and is wired.
- AnyWhereTally demo-done/thank-you email template exists and is wired.
- AnyWhereTally reschedule email template exists and is wired.
- Brand selector controls template, sender email, Calendar auth, Gmail auth, and Sheets auth.
- Google Sheet rows can be imported, previewed, processed, and updated.
- Excel rows can be imported, processed, and exported.
- Duplicate prevention skips old scheduled rows and avoids repeated emails.
- BullMQ worker can process large batches without holding the browser request open.
