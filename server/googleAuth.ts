import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { ExcelRow } from '../src/types';
import { prisma } from './db';
import {
  buildMeetingInviteEmail,
  buildNoResponseEmail,
  buildRescheduleEmail,
  buildRawEmail,
  buildReminderEmail,
  buildThankYouEmail,
  normalizeEmailBrand,
  type EmailBrandKey
} from './emailTemplates';
import { parseDateParts } from '../src/lib/dateFormat';

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

type StoredGoogleTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
};

function authStatePathForBrand(brand: EmailBrandKey) {
  return brand === 'tallykonnect'
    ? AUTH_STATE_PATH
    : path.join(dataDir, `auth_state_${brand}.json`);
}

export function getGoogleAuthEmail(brand?: EmailBrandKey) {
  const normalized = normalizeEmailBrand(brand);
  if (normalized === 'anywheretally') {
    return (
      process.env.GOOGLE_ANYWHERETALLY_AUTH_EMAIL ||
      process.env.GMAIL_ANYWHERETALLY_FROM_EMAIL ||
      'info.anywheretally@gmail.com'
    ).trim().toLowerCase();
  }

  return (
    process.env.GOOGLE_TALLYKONNECT_AUTH_EMAIL ||
    process.env.GOOGLE_AUTH_EMAIL ||
    process.env.GMAIL_TALLYKONNECT_FROM_EMAIL ||
    process.env.GMAIL_FROM_EMAIL ||
    'demo.tallykonnect@gmail.com'
  ).trim().toLowerCase();
}

function readLegacySavedTokens(brand?: EmailBrandKey): StoredGoogleTokens | null {
  if (normalizeEmailBrand(brand) !== 'tallykonnect') return null;
  if (!fs.existsSync(TOKENS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
  } catch (e) {
    console.error('Failed to parse saved Google tokens:', e);
    return null;
  }
}

async function saveTokens(tokens: StoredGoogleTokens, brand?: EmailBrandKey) {
  const email = getGoogleAuthEmail(brand);
  const existing = await prisma.googleAuth.findUnique({ where: { email } });
  const refreshToken = tokens.refresh_token || existing?.refreshToken || null;

  await prisma.googleAuth.upsert({
    where: { email },
    update: {
      accessToken: tokens.access_token || existing?.accessToken || null,
      refreshToken,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : existing?.expiryDate || null
    },
    create: {
      email,
      accessToken: tokens.access_token || null,
      refreshToken,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null
    }
  });
}

async function readSavedTokens(brand?: EmailBrandKey): Promise<StoredGoogleTokens | null> {
  const email = getGoogleAuthEmail(brand);
  const record = await prisma.googleAuth.findUnique({ where: { email } });
  if (record) {
    return {
      access_token: record.accessToken,
      refresh_token: record.refreshToken,
      expiry_date: record.expiryDate?.getTime() || null
    };
  }

  const legacyTokens = readLegacySavedTokens(brand);
  if (legacyTokens?.refresh_token || legacyTokens?.access_token) {
    await saveTokens(legacyTokens, brand);
    return legacyTokens;
  }

  return null;
}

// Get credentials from env or fallback configuration
export function getCredentials(brand?: EmailBrandKey) {
  const normalized = normalizeEmailBrand(brand);
  const isAnyWhereTally = normalized === 'anywheretally';
  const configuredRedirectUri = (
    (isAnyWhereTally ? process.env.GOOGLE_ANYWHERETALLY_REDIRECT_URI : process.env.GOOGLE_TALLYKONNECT_REDIRECT_URI) ||
    process.env.GOOGLE_REDIRECT_URI ||
    ''
  ).trim();
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
    brand: normalized,
    authEmail: getGoogleAuthEmail(normalized),
    clientId: (
      (isAnyWhereTally
        ? process.env.GOOGLE_ANYWHERETALLY_CLIENT_ID
        : process.env.GOOGLE_TALLYKONNECT_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) ||
      ''
    ).trim(),
    clientSecret: (
      (isAnyWhereTally
        ? process.env.GOOGLE_ANYWHERETALLY_CLIENT_SECRET
        : process.env.GOOGLE_TALLYKONNECT_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET) ||
      ''
    ).trim().split(/\s+/)[0] || '',
    redirectUri: redirectUri,
    envRefreshToken: (
      (isAnyWhereTally ? process.env.GOOGLE_ANYWHERETALLY_REFRESH_TOKEN : process.env.GOOGLE_TALLYKONNECT_REFRESH_TOKEN) ||
      (isAnyWhereTally ? '' : process.env.GOOGLE_REFRESH_TOKEN) ||
      ''
    )
  };
}

function isEnvTokenSuppressed(brand?: EmailBrandKey) {
  const statePath = authStatePathForBrand(normalizeEmailBrand(brand));
  if (!fs.existsSync(statePath)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return !!state.suppressEnvRefreshToken;
  } catch (err) {
    console.error('Failed to parse auth state:', err);
    return false;
  }
}

function setEnvTokenSuppressed(suppressed: boolean, brand?: EmailBrandKey) {
  const statePath = authStatePathForBrand(normalizeEmailBrand(brand));
  if (suppressed) {
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        suppressEnvRefreshToken: true,
        updatedAt: new Date().toISOString()
      }, null, 2),
      'utf-8'
    );
    return;
  }

  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}

export async function getOAuthClient(brand?: EmailBrandKey) {
  const { clientId, clientSecret, redirectUri, envRefreshToken } = getCredentials(brand);
  
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  const savedTokens = await readSavedTokens(brand);

  if (savedTokens && savedTokens.refresh_token) {
    oauth2Client.setCredentials({
      refresh_token: savedTokens.refresh_token,
      access_token: savedTokens.access_token || undefined,
      expiry_date: savedTokens.expiry_date || undefined
    });
  } else if (envRefreshToken && !isEnvTokenSuppressed(brand)) {
    oauth2Client.setCredentials({
      refresh_token: envRefreshToken
    });
  }

  // Handle token refreshing events to automatically persist them
  oauth2Client.on('tokens', async (tokens) => {
    try {
      const existing = await readSavedTokens(brand);
      const updated = {
        ...existing,
        ...tokens,
        // Make sure refresh_token is kept if the refresh event doesn't supply a new one
        refresh_token: tokens.refresh_token || existing?.refresh_token || envRefreshToken
      };
      await saveTokens(updated, brand);
      console.log('Successfully refreshed and saved Google Auth tokens to database.');
    } catch (err) {
      console.error('Failed to persist refreshed Google Auth tokens:', err);
    }
  });

  return oauth2Client;
}

// Robust excel date-time parsing helper
export function parseExcelDateTime(dateVal: any, timeVal: any): Date {
  const dateParts = parseDateParts(dateVal);
  let year = dateParts?.year || 0;
  let month = dateParts?.month || 0;
  let day = dateParts?.day || 0;
  let dateParsed = !!dateParts;
  let timeParsed = false;

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
    throw new Error('Invalid Date of Demo. Use a real date such as 10-06-2026.');
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

  if (isInvalidGrantError(err)) {
    return `${action} failed: Google authorization expired or was revoked. Reconnect the Google account and try again.`;
  }
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

export function isInvalidGrantError(error: any) {
  const responseData = error?.response?.data;
  const rawOAuthError = responseData?.error;
  const oauthError =
    typeof rawOAuthError === 'string'
      ? rawOAuthError
      : rawOAuthError?.status || rawOAuthError?.message || '';
  const description = [
    responseData?.error_description,
    typeof rawOAuthError === 'object' ? rawOAuthError?.message : '',
    error?.message
  ]
    .filter(Boolean)
    .join(' ');

  return (
    oauthError === 'invalid_grant' ||
    /invalid_grant|expired or revoked|token has been expired/i.test(description)
  );
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

async function sendRawGmailMessage(raw: string, brand?: EmailBrandKey) {
  const oauth2Client = await getOAuthClient(brand);
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

export async function sendGmailTemplate(
  to: string,
  template: { subject: string; text: string; html: string },
  brand?: EmailBrandKey
) {
  try {
    const emailBrand = brand || inferEmailBrandFromTemplate(template);
    const encodedMessage = buildRawEmail({
      to,
      fromEmail: getGoogleAuthEmail(emailBrand),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, emailBrand);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail email retry'));
  }
}

function inferEmailBrandFromTemplate(template: { subject?: string; text?: string; html?: string }): EmailBrandKey {
  const content = `${template.subject || ''}\n${template.text || ''}\n${template.html || ''}`;
  return /AnyWhereTally|anywheretally\.com|info@anywheretally\.com/i.test(content)
    ? 'anywheretally'
    : 'tallykonnect';
}

function calendarBrandCopy(brand?: EmailBrandKey) {
  const normalized = normalizeEmailBrand(brand);
  if (normalized === 'anywheretally') {
    return {
      summary: 'Tally Mobile App Demo - AnyWhereTally',
      description: 'Tally Mobile App demo scheduled by AnyWhereTally. For support, contact info@anywheretally.com.'
    };
  }

  return {
    summary: 'Smart TDS Demo - TallyKonnect',
    description: 'Smart TDS demo scheduled by TallyKonnect. For support, contact info@tallykonnect.com.'
  };
}

export async function scheduleMeeting(row: ExcelRow, brand?: EmailBrandKey) {
  try {
    const oauth2Client = await getOAuthClient(brand);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const dateVal = row['Date of Demo'];
    const timeVal = row['Time of Demo'];
    
    const startTime = parseExcelDateTime(dateVal, timeVal);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 mins later
    
    const attendees = [{ email: row.email }];
    const brandCopy = calendarBrandCopy(brand);

    const event = {
      summary: brandCopy.summary,
      description: brandCopy.description,
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

export async function updateCalendarMeeting(row: ExcelRow, calendarEventId: string, brand?: EmailBrandKey) {
  if (!calendarEventId) {
    throw new Error('Calendar event ID is required to reschedule this demo.');
  }

  try {
    const oauth2Client = await getOAuthClient(brand);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const startTime = parseExcelDateTime(row['Date of Demo'], row['Time of Demo']);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
    const brandCopy = calendarBrandCopy(brand);

    const response = await withCalendarRetry(() =>
      calendar.events.patch({
        calendarId: 'primary',
        eventId: calendarEventId,
        requestBody: {
          summary: brandCopy.summary,
          description: brandCopy.description.replace('scheduled by', 'rescheduled by'),
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

export async function sendThankYouEmail(row: ExcelRow, brand?: EmailBrandKey) {
  try {
    const template = buildThankYouEmail({
      fullName: row.full_name,
      brand
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      fromEmail: getGoogleAuthEmail(brand),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, brand);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail thank-you email'));
  }
}

export async function sendNoResponseEmail(row: ExcelRow, brand?: EmailBrandKey) {
  try {
    const template = buildNoResponseEmail({
      fullName: row.full_name,
      brand
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      fromEmail: getGoogleAuthEmail(brand),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, brand);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail Not Attended email'));
  }
}

export async function sendGmailInvite(row: ExcelRow, meetLink: string, brand?: EmailBrandKey) {
  try {
    const template = buildMeetingInviteEmail({
      fullName: row.full_name,
      date: String(row['Date of Demo'] || ''),
      time: String(row['Time of Demo'] || ''),
      meetLink,
      brand
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      fromEmail: getGoogleAuthEmail(brand),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, brand);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail invitation'));
  }
}

export async function sendGmailRescheduleInvite(
  row: ExcelRow,
  meetLink: string,
  previous?: { date?: string; time?: string },
  brand?: EmailBrandKey
) {
  try {
    const template = buildRescheduleEmail({
      fullName: row.full_name,
      date: String(row['Date of Demo'] || ''),
      time: String(row['Time of Demo'] || ''),
      meetLink,
      oldDate: previous?.date,
      oldTime: previous?.time,
      brand
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      fromEmail: getGoogleAuthEmail(brand),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, brand);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail reschedule invitation'));
  }
}

export async function sendGmailReminder(fullName: string, email: string, dateStr: string, timeStr: string, meetLink: string, brand?: EmailBrandKey) {
  try {
    const template = buildReminderEmail({
      fullName,
      date: dateStr,
      time: timeStr,
      meetLink,
      brand
    });
    const encodedMessage = buildRawEmail({
      to: email,
      fromEmail: getGoogleAuthEmail(brand),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, brand);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail reminder email'));
  }
}

// Check tokens save status to determine authorization validity
export async function getAuthStatus(brand?: EmailBrandKey) {
  const normalizedBrand = normalizeEmailBrand(brand);
  const { clientId, clientSecret, redirectUri, envRefreshToken, authEmail } = getCredentials(normalizedBrand);
  const configured = !!(clientId && clientSecret);
  const envTokenSuppressed = isEnvTokenSuppressed(normalizedBrand);
  
  let authenticated = false;
  let isUsingEnvToken = false;
  let requiresReconnect = false;
  let authError: string | undefined;

  const savedTokens = await readSavedTokens(normalizedBrand);
  const hasSavedToken = !!savedTokens?.refresh_token;
  const hasEnvToken = !!(envRefreshToken && !envTokenSuppressed);

  if (configured && (hasSavedToken || hasEnvToken)) {
    try {
      const oauth2Client = await getOAuthClient(normalizedBrand);
      await oauth2Client.getAccessToken();
      authenticated = true;
      isUsingEnvToken = !hasSavedToken && hasEnvToken;
    } catch (error: any) {
      if (isInvalidGrantError(error)) {
        await clearCredentials(normalizedBrand);
        requiresReconnect = true;
        authError = 'Google authorization expired or was revoked. Connect Google again.';
      } else {
        authError = error?.message || 'Google authentication check failed.';
      }
    }
  }

  let authUrl = '';
  if (configured) {
    const oauth2Client = new google.auth.OAuth2(clientId, 'SECRET_MASKED', redirectUri);
    authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_OAUTH_SCOPES,
      state: normalizedBrand,
      prompt: 'consent'
    });
  }

  return {
    brand: normalizedBrand,
    email: authEmail,
    configured,
    authenticated,
    clientId: clientId ? `${clientId.slice(0, 10)}...` : undefined,
    redirectUri,
    authUrl,
    isUsingEnvToken,
    envTokenSuppressed,
    requiresReconnect,
    authError
  };
}

// Exchange callback authorization code for tokens and save
export async function exchangeCodeAndSave(code: string, brand?: EmailBrandKey) {
  const normalizedBrand = normalizeEmailBrand(brand);
  const { clientId, clientSecret, redirectUri } = getCredentials(normalizedBrand);
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  
  const { tokens } = await oauth2Client.getToken(code);
  
  const existing = await readSavedTokens(normalizedBrand);
  const updated: StoredGoogleTokens = {
    ...existing,
    ...tokens
  };

  await saveTokens(updated, normalizedBrand);
  setEnvTokenSuppressed(false, normalizedBrand);
  console.log(`Saved Google Auth tokens for ${getGoogleAuthEmail(normalizedBrand)} directly from exchangeCodeAndSave.`);
  return updated;
}

export async function clearCredentials(brand?: EmailBrandKey) {
  const normalizedBrand = normalizeEmailBrand(brand);
  await prisma.googleAuth.deleteMany({ where: { email: getGoogleAuthEmail(normalizedBrand) } });
  if (normalizedBrand === 'tallykonnect' && fs.existsSync(TOKENS_PATH)) {
    fs.unlinkSync(TOKENS_PATH);
  }
  console.log('Google Auth tokens cleared.');
  setEnvTokenSuppressed(true, normalizedBrand);
  console.log('Environment refresh token disabled for this local session.');
}
