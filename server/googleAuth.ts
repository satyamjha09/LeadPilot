import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { ExcelRow } from '../src/types';
import {
  buildMeetingInviteEmail,
  buildNoResponseEmail,
  buildRescheduleEmail,
  buildRawEmail,
  buildReminderEmail,
  buildThankYouEmail
} from './emailTemplates';

const TOKENS_PATH = path.join(process.cwd(), 'data', 'google_tokens.json');
const AUTH_STATE_PATH = path.join(process.cwd(), 'data', 'auth_state.json');
const GOOGLE_CALENDAR_TIME_ZONE = 'Asia/Kolkata';
const GOOGLE_CALENDAR_TIME_ZONE_OFFSET_MINUTES = 5 * 60 + 30;
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/spreadsheets'
];

// Ensure data directory exists
const dataDir = path.dirname(TOKENS_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Get credentials from env or fallback configuration
export function getCredentials() {
  const configuredRedirectUri = (process.env.GOOGLE_REDIRECT_URI || '').trim();
  let baseUri = process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL' ? process.env.APP_URL : '';
  let redirectUri = configuredRedirectUri;

  if (!redirectUri) {
    if (!baseUri) {
      baseUri = 'http://localhost:3000';
    }
    if (baseUri.endsWith('/')) {
      baseUri = baseUri.slice(0, -1);
    }
    redirectUri = `${baseUri}/api/auth/callback/google`;
  }

  return {
    clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim().split(/\s+/)[0] || '',
    redirectUri: redirectUri,
    envRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || ''
  };
}

function isEnvTokenSuppressed() {
  if (!fs.existsSync(AUTH_STATE_PATH)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf-8'));
    return !!state.suppressEnvRefreshToken;
  } catch (err) {
    console.error('Failed to parse auth state:', err);
    return false;
  }
}

function setEnvTokenSuppressed(suppressed: boolean) {
  if (suppressed) {
    fs.writeFileSync(
      AUTH_STATE_PATH,
      JSON.stringify({
        suppressEnvRefreshToken: true,
        updatedAt: new Date().toISOString()
      }, null, 2),
      'utf-8'
    );
    return;
  }

  if (fs.existsSync(AUTH_STATE_PATH)) {
    fs.unlinkSync(AUTH_STATE_PATH);
  }
}

export function getOAuthClient() {
  const { clientId, clientSecret, redirectUri, envRefreshToken } = getCredentials();
  
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  // Check if we have token saved in tokens file
  let savedTokens: any = null;
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      const data = fs.readFileSync(TOKENS_PATH, 'utf-8');
      savedTokens = JSON.parse(data);
    } catch (e) {
      console.error('Failed to parse saved tokens:', e);
    }
  }

  if (savedTokens && savedTokens.refresh_token) {
    oauth2Client.setCredentials({
      refresh_token: savedTokens.refresh_token,
      access_token: savedTokens.access_token || undefined,
      expiry_date: savedTokens.expiry_date || undefined
    });
  } else if (envRefreshToken && !isEnvTokenSuppressed()) {
    oauth2Client.setCredentials({
      refresh_token: envRefreshToken
    });
  }

  // Handle token refreshing events to automatically persist them
  oauth2Client.on('tokens', (tokens) => {
    try {
      let existing: any = {};
      if (fs.existsSync(TOKENS_PATH)) {
        existing = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
      }
      const updated = {
        ...existing,
        ...tokens,
        // Make sure refresh_token is kept if the refresh event doesn't supply a new one
        refresh_token: tokens.refresh_token || existing.refresh_token || envRefreshToken
      };
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(updated, null, 2), 'utf-8');
      console.log('Successfully refreshed and saved Google Auth tokens.');
    } catch (err) {
      console.error('Failed to write refreshed tokens:', err);
    }
  });

  return oauth2Client;
}

// Robust excel date-time parsing helper
export function parseExcelDateTime(dateVal: any, timeVal: any): Date {
  let year = 0;
  let month = 0;
  let day = 0;
  let dateParsed = false;
  let timeParsed = false;
  
  // Parse Date
  if (typeof dateVal === 'number') {
    // Excel serial date format (days since 1900-01-01)
    const parsedDate = new Date((dateVal - 25569) * 86400 * 1000);
    year = parsedDate.getUTCFullYear();
    month = parsedDate.getUTCMonth() + 1;
    day = parsedDate.getUTCDate();
    dateParsed = !isNaN(parsedDate.getTime());
  } else if (dateVal instanceof Date) {
    year = dateVal.getUTCFullYear();
    month = dateVal.getUTCMonth() + 1;
    day = dateVal.getUTCDate();
    dateParsed = !isNaN(dateVal.getTime());
  } else if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();
    const parts = trimmed.split(/[-/.]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        year = parseInt(parts[0]);
        month = parseInt(parts[1]);
        day = parseInt(parts[2]);
        dateParsed = true;
      } else {
        // DD/MM/YYYY or MM/DD/YYYY
        let p1 = parseInt(parts[0]);
        let p2 = parseInt(parts[1]);
        let p3 = parseInt(parts[2]);
        if (p3 < 100) p3 += 2000; // handle YY format

        if (p1 > 12) {
          // Must be DD/MM/YYYY
          year = p3;
          month = p2;
          day = p1;
        } else {
          // Fallback: Assume MM/DD/YYYY
          year = p3;
          month = p1;
          day = p2;
        }
        dateParsed = true;
      }
    } else {
      const parsed = Date.parse(trimmed);
      if (!isNaN(parsed)) {
        const parsedDate = new Date(parsed);
        year = parsedDate.getUTCFullYear();
        month = parsedDate.getUTCMonth() + 1;
        day = parsedDate.getUTCDate();
        dateParsed = true;
      }
    }
  }

  // Parse Time
  let hrs = 9;
  let mins = 0;
  if (typeof timeVal === 'number') {
    // Excel fractional day (e.g. 0.5 for 12:00 PM)
    const totalSecs = Math.round(timeVal * 86400);
    hrs = Math.floor(totalSecs / 3600);
    mins = Math.floor((totalSecs % 3600) / 60);
    timeParsed = totalSecs >= 0 && totalSecs < 86400;
  } else if (timeVal instanceof Date) {
    hrs = timeVal.getUTCFullYear() <= 1900 ? timeVal.getUTCHours() : timeVal.getHours();
    mins = timeVal.getUTCFullYear() <= 1900 ? timeVal.getUTCMinutes() : timeVal.getMinutes();
    timeParsed = !isNaN(timeVal.getTime());
  } else if (typeof timeVal === 'string') {
    const trimmed = timeVal.trim();
    const parsedTime = Date.parse(trimmed);
    if (!isNaN(parsedTime) && trimmed.includes('T')) {
      const parsedDate = new Date(parsedTime);
      hrs = parsedDate.getUTCFullYear() <= 1900 ? parsedDate.getUTCHours() : parsedDate.getHours();
      mins = parsedDate.getUTCFullYear() <= 1900 ? parsedDate.getUTCMinutes() : parsedDate.getMinutes();
      timeParsed = true;
    }
    const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/i);
    if (match && isNaN(parsedTime)) {
      hrs = parseInt(match[1]);
      mins = parseInt(match[2] || '0');
      const ampm = match[3];
      if (ampm) {
        if ((ampm.toLowerCase() === 'pm') && hrs < 12) hrs += 12;
        if ((ampm.toLowerCase() === 'am') && hrs === 12) hrs = 0;
      }
      timeParsed = hrs >= 0 && hrs <= 23 && mins >= 0 && mins <= 59;
    }
  }

  if (!dateParsed) {
    throw new Error('Invalid Date of Demo. Use a real date such as 2026-06-10.');
  }

  if (!timeParsed) {
    throw new Error('Invalid Time of Demo. Use a real time such as 10:30 AM.');
  }

  const localTimestamp = Date.UTC(year, month - 1, day, hrs, mins, 0, 0);
  return new Date(localTimestamp - GOOGLE_CALENDAR_TIME_ZONE_OFFSET_MINUTES * 60 * 1000);
}

function toCalendarDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const localDate = new Date(date.getTime() + GOOGLE_CALENDAR_TIME_ZONE_OFFSET_MINUTES * 60 * 1000);
  return [
    localDate.getUTCFullYear(),
    pad(localDate.getUTCMonth() + 1),
    pad(localDate.getUTCDate())
  ].join('-') + `T${pad(localDate.getUTCHours())}:${pad(localDate.getUTCMinutes())}:${pad(localDate.getUTCSeconds())}`;
}

function friendlyGoogleError(err: any, action: string): string {
  const status = err?.code || err?.response?.status;
  const details = getGoogleErrorDetails(err);
  const detail = err?.response?.data?.error_description
    || details.message
    || err?.response?.data?.error?.message
    || err?.errors?.[0]?.message
    || err?.message;

  if (status === 401) {
    return `${action} failed: Google authorization expired. Reconnect the Google account and try again.`;
  }
  if (status === 403) {
    const reason = details.reason || details.status || 'permission_or_quota';
    if (reason === 'quotaExceeded' || /quota|usage limits/i.test(detail || '')) {
      return `${action} blocked: Google Calendar is temporarily restricted. Add a Meet link manually or retry later.`;
    }
    return `${action} failed: ${reason} - ${detail || 'Google denied permission or quota.'}`;
  }
  if (status === 429) {
    return `${action} failed: Google rate limit reached. Wait a minute and retry the failed rows.`;
  }
  if (status === 400) {
    return `${action} failed: Google rejected the event details. Check recipient email, date, and time.`;
  }

  return `${action} failed${detail ? `: ${detail}` : '.'}`;
}

function getGoogleErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') {
    return { message: String(error) };
  }

  const googleError = error as {
    message?: string;
    code?: number | string;
    response?: {
      status?: number;
      data?: {
        error?: {
          code?: number;
          message?: string;
          status?: string;
          errors?: Array<{
            domain?: string;
            reason?: string;
            message?: string;
          }>;
        };
      };
    };
  };

  const apiError = googleError.response?.data?.error;
  const firstError = apiError?.errors?.[0];

  return {
    httpStatus: googleError.response?.status,
    code: apiError?.code ?? googleError.code,
    status: apiError?.status,
    reason: firstError?.reason,
    domain: firstError?.domain,
    message:
      firstError?.message ??
      apiError?.message ??
      googleError.message ??
      'Unknown Google API error'
  };
}

async function withCalendarRetry<T>(action: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const details = getGoogleErrorDetails(error);
      const retryableReasons = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
      const retryable =
        retryableReasons.has(details.reason || '') ||
        details.httpStatus === 429 ||
        (details.httpStatus !== undefined && details.httpStatus >= 500);

      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = Math.min(2 ** attempt * 1000, 32_000) + Math.floor(Math.random() * 1000);
      console.warn('CALENDAR_EVENT_CREATE_RETRY', {
        attempt,
        delayMs,
        reason: details.reason,
        httpStatus: details.httpStatus,
        message: details.message
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

async function sendRawGmailMessage(raw: string) {
  const oauth2Client = getOAuthClient();
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });

  const messageId = response.data.id;
  if (!messageId) {
    throw new Error('Gmail accepted the request but returned no message ID.');
  }

  return {
    messageId,
    threadId: response.data.threadId || undefined
  };
}

export async function scheduleMeeting(row: ExcelRow) {
  try {
    const oauth2Client = getOAuthClient();
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const dateVal = row['Date of Demo'];
    const timeVal = row['Time of Demo'];
    
    const startTime = parseExcelDateTime(dateVal, timeVal);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 mins later
    
    const attendees = [{ email: row.email }];

    const event = {
      summary: 'Smart TDS Demo - TallyKonnect',
      description: 'Smart TDS demo scheduled by TallyKonnect. For support, contact info@tallykonnect.com.',
      start: {
        dateTime: toCalendarDateTime(startTime),
        timeZone: GOOGLE_CALENDAR_TIME_ZONE,
      },
      end: {
        dateTime: toCalendarDateTime(endTime),
        timeZone: GOOGLE_CALENDAR_TIME_ZONE,
      },
      attendees,
      conferenceData: {
        createRequest: {
          requestId: `meet-${row.id}-${Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      },
    };

    const response = await withCalendarRetry(() =>
      calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
        conferenceDataVersion: 1, // Required to trigger Google Meet generation
        sendUpdates: 'all',
      })
    );

    const meetLink = response.data.hangoutLink || response.data.conferenceData?.entryPoints?.[0]?.uri;
    if (!meetLink) {
      throw new Error('Could not generate Google Meet link from event.');
    }

    return {
      meetLink,
      eventId: response.data.id || '',
      startTime: startTime.getTime()
    };
  } catch (err: any) {
    const details = getGoogleErrorDetails(err);
    console.error('CALENDAR_EVENT_CREATE_FAILED', details);
    throw new Error(friendlyGoogleError(err, 'Calendar event creation'));
  }
}

export async function updateCalendarMeeting(row: ExcelRow, calendarEventId: string) {
  if (!calendarEventId) {
    throw new Error('Calendar event ID is required to reschedule this demo.');
  }

  try {
    const oauth2Client = getOAuthClient();
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const startTime = parseExcelDateTime(row['Date of Demo'], row['Time of Demo']);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    const response = await withCalendarRetry(() =>
      calendar.events.patch({
        calendarId: 'primary',
        eventId: calendarEventId,
        requestBody: {
          summary: 'Smart TDS Demo - TallyKonnect',
          description: 'Smart TDS demo rescheduled by TallyKonnect. For support, contact info@tallykonnect.com.',
          start: {
            dateTime: toCalendarDateTime(startTime),
            timeZone: GOOGLE_CALENDAR_TIME_ZONE,
          },
          end: {
            dateTime: toCalendarDateTime(endTime),
            timeZone: GOOGLE_CALENDAR_TIME_ZONE,
          },
          attendees: [{ email: row.email }]
        },
        sendUpdates: 'all',
      })
    );

    return {
      meetLink: response.data.hangoutLink || response.data.conferenceData?.entryPoints?.[0]?.uri || '',
      eventId: response.data.id || calendarEventId,
      startTime: startTime.getTime()
    };
  } catch (err: any) {
    const details = getGoogleErrorDetails(err);
    console.error('CALENDAR_EVENT_UPDATE_FAILED', details);
    throw new Error(friendlyGoogleError(err, 'Calendar event update'));
  }
}

export async function sendThankYouEmail(row: ExcelRow) {
  try {
    const template = buildThankYouEmail({
      fullName: row.full_name
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail thank-you email'));
  }
}

export async function sendNoResponseEmail(row: ExcelRow) {
  try {
    const template = buildNoResponseEmail({
      fullName: row.full_name
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail No Response email'));
  }
}

export async function sendGmailInvite(row: ExcelRow, meetLink: string) {
  try {
    const template = buildMeetingInviteEmail({
      fullName: row.full_name,
      date: String(row['Date of Demo'] || ''),
      time: String(row['Time of Demo'] || ''),
      meetLink
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail invitation'));
  }
}

export async function sendGmailRescheduleInvite(
  row: ExcelRow,
  meetLink: string,
  previous?: { date?: string; time?: string }
) {
  try {
    const template = buildRescheduleEmail({
      fullName: row.full_name,
      date: String(row['Date of Demo'] || ''),
      time: String(row['Time of Demo'] || ''),
      meetLink,
      oldDate: previous?.date,
      oldTime: previous?.time
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail reschedule invitation'));
  }
}

export async function sendGmailReminder(fullName: string, email: string, dateStr: string, timeStr: string, meetLink: string) {
  try {
    const template = buildReminderEmail({
      fullName,
      date: dateStr,
      time: timeStr,
      meetLink
    });
    const encodedMessage = buildRawEmail({
      to: email,
      ...template
    });

    return await sendRawGmailMessage(encodedMessage);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail reminder email'));
  }
}

// Check tokens save status to determine authorization validity
export async function getAuthStatus() {
  const { clientId, clientSecret, redirectUri, envRefreshToken } = getCredentials();
  const configured = !!(clientId && clientSecret);
  const envTokenSuppressed = isEnvTokenSuppressed();
  
  let authenticated = false;
  let isUsingEnvToken = false;

  if (fs.existsSync(TOKENS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
      authenticated = !!data.refresh_token;
    } catch (e) {
      console.error('Error verifying auth status from tokens file:', e);
    }
  }

  if (!authenticated && envRefreshToken && !envTokenSuppressed) {
    authenticated = true;
    isUsingEnvToken = true;
  }

  let authUrl = '';
  if (configured) {
    const oauth2Client = new google.auth.OAuth2(clientId, 'SECRET_MASKED', redirectUri);
    authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_OAUTH_SCOPES,
      prompt: 'consent'
    });
  }

  return {
    configured,
    authenticated,
    clientId: clientId ? `${clientId.slice(0, 10)}...` : undefined,
    redirectUri,
    authUrl,
    isUsingEnvToken,
    envTokenSuppressed
  };
}

// Exchange callback authorization code for tokens and save
export async function exchangeCodeAndSave(code: string) {
  const { clientId, clientSecret, redirectUri } = getCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  
  const { tokens } = await oauth2Client.getToken(code);
  
  let existing: any = {};
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
    } catch (e) {}
  }

  const updated = {
    ...existing,
    ...tokens
  };

  fs.writeFileSync(TOKENS_PATH, JSON.stringify(updated, null, 2), 'utf-8');
  setEnvTokenSuppressed(false);
  console.log('Saved tokens directly from exchangeCodeAndSave.');
  return updated;
}

export function clearCredentials() {
  if (fs.existsSync(TOKENS_PATH)) {
    fs.unlinkSync(TOKENS_PATH);
    console.log('Google Auth tokens cleared.');
  }
  setEnvTokenSuppressed(true);
  console.log('Environment refresh token disabled for this local session.');
}
