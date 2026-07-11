# Excel Meet Scheduler

Upload an Excel sheet or import a Google Sheets URL, create Google Calendar events with Google Meet links, send Gmail invitations, and update the source sheet or export Excel.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill in:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback/google
GOOGLE_REFRESH_TOKEN=
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/tallykonnect_dev?schema=public"
```

`GOOGLE_REFRESH_TOKEN` is optional. If you use it, **Clear Session** in the app disables that env token for the current local session until you link Google again.

Do not use `file:./dev.db` for this app in production. The demo workflow needs persistent database state for active sessions, demo history, and idempotent email delivery.

3. Initialize the database:

```bash
npx prisma migrate dev
npx prisma generate
```

4. In Google Cloud Console, enable:

- Google Calendar API
- Gmail API
- Google Sheets API

Required OAuth scopes:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/spreadsheets`

**Important:** After adding or changing OAuth scopes, reconnect Google in the app or regenerate your refresh token so the saved token includes Calendar, Gmail, and Sheets access.

**Production security:** Do not commit `.env`, `data/google_tokens.json`, refresh tokens, client secrets, or local database files. If any Google client secret or refresh token was exposed during local testing, rotate it before production use.

5. Add this OAuth redirect URI in Google Cloud Console:

```text
http://localhost:3000/api/auth/callback/google
```

6. Start the app:

```bash
npm run dev
```

7. Open:

```text
http://localhost:3000
```

## Google Sheets import

1. Choose **Google Sheet Link** in the import panel.
2. Paste a sheet URL (with or without `gid` for a specific tab).
3. Preview rows, select pending rows, and click **Schedule & Send Selected**.
4. The backend updates **Meeting Details**, **lead_status**, and **remarks** on the same Google Sheet rows.

Supported URL formats include:

- `https://docs.google.com/spreadsheets/d/{id}/edit#gid={gid}`
- `https://docs.google.com/spreadsheets/d/{id}/edit?gid={gid}`
- `https://docs.google.com/spreadsheets/d/{id}` (first tab)

## Render + PostgreSQL

Use Render Postgres for production. In Render environment variables, set `DATABASE_URL` to the Render Postgres internal database URL without quotes:

```text
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

Recommended Render commands:

```bash
# Build command
npm install && npx prisma generate && npm run build

# Pre-deploy command
npx prisma migrate deploy

# Start command
npm start
```

## Duplicate prevention (Prisma + PostgreSQL)

The app stores each lead schedule in PostgreSQL using a unique key:

`email` + `dateOfDemo` + `timeOfDemo` (normalized, email lowercased)

Before creating a Calendar event or email:

- If a row is already **Demo Scheduled** with a Meet link in the database, Calendar and Gmail are skipped and the existing link is reused.
- If a matching email log already exists for **Demo Scheduled** or **Demo Done**, the duplicate email is skipped.
- If a prior attempt **Failed**, scheduling is retried on the next run.
- Excel and Google Sheet files remain the display source; the database is the source of truth for duplicates.

## Excel columns

Required input columns can use flexible names. Recommended:

- `full_name`
- `email`
- `Date of Demo`
- `Time of Demo`
- `Meeting Details`
- `lead_status`
- `Remarks`

Export preserves original Excel columns and only updates:

- `Meeting Details`
- `lead_status`
- `Remarks`

Rows that already contain a `meet.google.com` link in **Meeting Details** are skipped. Google Sheet imports update these same three columns directly in the sheet.

## Email brand selection

Before final processing, the preview dialog lets you choose the email brand:

- `TallyKonnect`
- `AnyWhereTally`

The scheduling workflow, duplicate prevention, Google Meet creation, and Google Sheet updates stay the same. The selected brand changes the email logo, company name, website, contact email, footer, and sender display name.

## Redis + BullMQ background processing

Inline processing remains available through `POST /api/process-leads`.

When `PROCESS_QUEUE_ENABLED=true`, the frontend uses the background queue:

1. `POST /api/process-leads/jobs` stores a durable job in PostgreSQL and enqueues it in BullMQ.
2. `npm run worker:process-leads` processes the job in the background.
3. `GET /api/process-leads/jobs/:jobId` returns status, progress, rows, and summary for frontend polling.

Redis runs the queue. PostgreSQL remains the durable source for job progress/results and duplicate prevention.
