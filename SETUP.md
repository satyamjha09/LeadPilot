# Excel Meet Scheduler — Setup & Guidelines

Excel Meet Scheduler is a robust, full-stack web application designed to automate booking Google Meet sessions directly from uploaded spreadsheets, dispatch professional Gmail invitations, and manage automated email reminders.

---

## ⚙️ Environment Variables Config (.env)

Duplicate `.env.example` to `.env` or create `.env` in the root directory:

```env
# Google Workspace OAuth Credentials
GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID"
GOOGLE_CLIENT_SECRET="YOUR_GOOGLE_CLIENT_SECRET"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/auth/callback/google"

# Optional: Pre-configured Refresh Token (if absent, link dynamically via UI button)
GOOGLE_REFRESH_TOKEN=""

# PostgreSQL database for demo state, history, and duplicate prevention
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/tallykonnect_dev?schema=public"
```

After first clone, run:

```bash
npx prisma migrate dev
npx prisma generate
```

Do not use `DATABASE_URL="file:./dev.db"` on Render. Render services can lose local filesystem state on restart/redeploy unless you attach a persistent disk, and this app requires persistent demo state for Demo Done / No Response. Use Render Postgres and set `DATABASE_URL` to the internal Postgres URL without quotes.

### 🛰️ How to obtain Google credentials
1. Create or open a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Calendar API**, **Gmail API**, and **Google Sheets API**.
3. Go to **APIs & Services > Credentials** and configure your **OAuth Consent Screen** (User Type: External/Internal). Make sure to add scopes:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/spreadsheets`
4. Create an **OAuth Client ID** (Application Type: Web Application).
5. Specify Authorized Redirect URI:
   - `http://localhost:3000/api/auth/callback/google`
6. Copy the resulting **Client ID** and **Client Secret** into your `.env` file!

If you add or change OAuth scopes after already linking Google, click **Clear Session** in the app and link Google again, or regenerate `GOOGLE_REFRESH_TOKEN`. Old refresh tokens will not automatically receive new Calendar, Gmail, or Sheets permissions.

---

## 🚀 Running Locally

Follow these commands to boot up the full-stack development instance:

```bash
# 1. Install all dependencies from package.json
npm install

# 2. Start the integrated Express API + Vite dev server
npm run dev
```

The application will bind to **`http://localhost:3000`**. Open that link in your browser to interact with the dashboard.

### Render deployment

Use these commands on Render:

```bash
# Build command
npm install && npx prisma generate && npm run build

# Pre-deploy command
npx prisma migrate deploy

# Start command
npm start
```

---

## 🎨 Expected Excel Sheet Columns

The spreadsheet parser accepts standard `.xlsx` or `.xls` spreadsheets containing the following case-insensitive column headers:

* `full_name` — Lead attendee name (e.g. `John Doe`)
* `email` — Contact email sequence (e.g. `john.doe@gmail.com`)
* `Date of Demo` — Target booking date (e.g. `2026-06-10` or a standard serial date number)
* `Time of Demo` — Target booking hour (e.g. `14:30` or `2:30 PM`)
* `Meeting Details` — Leave blank or empty (Google Meet url will populate here)
* `lead_status` — Lead workflow state (`Demo Scheduled`, `Demo Done`, `No Response`, `Follow Up`, `To be called`, `Not Required`, `Repeated`, `Reschedule`)
* `Remarks` — Automated diagnosis log entries

---

## ⚡ Key Architecture Highlights
* **Granular Multi-Selection Tools**: Target specific rows by checking row markers individually, Shift-clicking range boundaries, or selecting indices slices in numeric controllers (e.g., Row 1 to Row 15).
* **Automated background Checkers**: The scheduling processor runs background scans looking for meetings scheduled within your configurable window (e.g. `2 hours` before demo) to dispatch reminders automatically without locking up the client.
* **Resilient parsing logic**: Serial excel times/dates are converted automatically using safe fractional JS converters, catching minor formatting bugs gracefully.
