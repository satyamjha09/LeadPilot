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
DATA_DIR=./data
DATABASE_URL="file:./dev.db"
```

`GOOGLE_REFRESH_TOKEN` is optional. If you use it, **Clear Session** in the app disables that env token for the current local session until you link Google again.

3. Initialize the database:

```bash
npx prisma migrate dev --name init
npx prisma generate
```

4. In Google Cloud Console, enable:

- Google Calendar API
- Gmail API
- Google Sheets API

Required OAuth scopes:

- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/spreadsheets`

**Important:** After adding the Google Sheets scope, reconnect Google in the app or regenerate your refresh token so the saved token includes spreadsheet access.

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

## Render deployment for small/private use

For a small private deployment, SQLite is fine if you attach a Render persistent disk.

1. Create a Render **Web Service** from this GitHub repo.
2. Attach a persistent disk with mount path:

```text
/var/data
```

3. Use these commands:

```bash
npm install && npm run build
```

```bash
npm start
```

4. Add Render environment variables:

```env
APP_URL=https://your-render-app.onrender.com
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=https://your-render-app.onrender.com/api/auth/callback/google
DATA_DIR=/var/data
DATABASE_URL=file:/var/data/leadpilot.db
```

5. In Google Cloud Console, add this authorized redirect URI:

```text
https://your-render-app.onrender.com/api/auth/callback/google
```

`DATA_DIR` stores Google tokens, auth state, and reminder files. `DATABASE_URL` stores the SQLite database on the persistent disk.

## Google Sheets import

1. Choose **Google Sheet Link** in the import panel.
2. Paste a sheet URL (with or without `gid` for a specific tab).
3. Preview rows, select pending rows, and click **Schedule & Send Selected**.
4. The backend updates **Meeting Details**, **lead_status**, and **remarks** on the same Google Sheet rows.

Supported URL formats include:

- `https://docs.google.com/spreadsheets/d/{id}/edit#gid={gid}`
- `https://docs.google.com/spreadsheets/d/{id}/edit?gid={gid}`
- `https://docs.google.com/spreadsheets/d/{id}` (first tab)

## Duplicate prevention (Prisma + SQLite)

The app stores each lead schedule in SQLite using a unique key:

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

## Future Redis + BullMQ upgrade

**Current mode:** Selected rows are processed inline inside `POST /api/schedule` or `POST /api/sheets/schedule`, with a 1-second pause between rows.

**Future mode (planned):**

1. API creates a batch and enqueues one BullMQ job per row.
2. A worker processes Calendar, Gmail, and Google Sheet updates with retries and rate limiting.
3. The frontend polls a status endpoint for progress.

Stub files live under `server/jobs/`. Redis is **not** required today. To experiment later, install `bullmq` and `ioredis`, set `ENABLE_SCHEDULER_QUEUE=true`, and implement the TODOs in `schedulerQueue.ts` and `schedulerWorker.ts`.
