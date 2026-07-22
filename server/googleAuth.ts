import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import { ExcelRow } from '../src/types';
import { prisma } from './db';
import {
  buildMeetingInviteEmail,
  buildNoResponseEmail,
  buildRescheduleEmail,
  buildRawEmail,
  buildReminderEmail,
  buildThankYouEmail
} from './emailTemplates';
import { coerceStoredEmailBrand, emailBrandLabel, type EmailBrandKey } from '../src/lib/emailBrand';
import {
  coerceStoredSenderAccountKey,
  defaultEmailBrandForSenderAccount,
  parseSenderAccountKey,
  senderAccountEmail,
  senderAccountFromName,
  type SenderAccountKey
} from '../src/lib/senderAccount';
import { GOOGLE_SENDER_ACCOUNTS, SENDER_ACCOUNT_KEYS } from './googleSenderAccounts';
import { parseDateParts } from '../src/lib/dateFormat';

const GOOGLE_AUTH_DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const TOKENS_PATH = path.join(GOOGLE_AUTH_DATA_DIR, 'google_tokens.json');
const AUTH_STATE_PATH = path.join(GOOGLE_AUTH_DATA_DIR, 'auth_state.json');
const GOOGLE_CALENDAR_TIME_ZONE = 'Asia/Kolkata';
const GOOGLE_CALENDAR_TIME_ZONE_OFFSET_MINUTES = 5 * 60 + 30;
const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/spreadsheets'
];
export const GOOGLE_RECONNECT_MESSAGE = 'Google authorization expired or was revoked. Reconnect this Google account.';

export class GoogleAccountMismatchError extends Error {
  code = 'GOOGLE_ACCOUNT_MISMATCH';
  statusCode = 400;
  expectedEmail: string;
  connectedEmail: string;

  constructor(senderAccountKey: SenderAccountKey, expectedEmail: string, connectedEmail: string) {
    super(`${GOOGLE_SENDER_ACCOUNTS[senderAccountKey].displayName} must be connected using ${expectedEmail}.`);
    this.name = 'GoogleAccountMismatchError';
    this.expectedEmail = expectedEmail;
    this.connectedEmail = connectedEmail;
  }
}

// Ensure data directory exists
const dataDir = GOOGLE_AUTH_DATA_DIR;
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

type StoredGoogleTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
};

function authStatePathForSender(senderAccountKey: SenderAccountKey) {
  return senderAccountKey === 'tallykonnect-google'
    ? AUTH_STATE_PATH
    : path.join(dataDir, `auth_state_${senderAccountKey}.json`);
}

export function getGoogleSenderEmail(senderAccountKey?: SenderAccountKey) {
  const normalized = coerceStoredSenderAccountKey(senderAccountKey);
  if (normalized === 'anywheretally-google') {
    return (
      process.env.GOOGLE_ANYWHERETALLY_AUTH_EMAIL ||
      process.env.GMAIL_ANYWHERETALLY_FROM_EMAIL ||
      senderAccountEmail('anywheretally-google')
    ).trim().toLowerCase();
  }

  return (
    process.env.GOOGLE_TALLYKONNECT_AUTH_EMAIL ||
    process.env.GOOGLE_AUTH_EMAIL ||
    process.env.GMAIL_TALLYKONNECT_FROM_EMAIL ||
    process.env.GMAIL_FROM_EMAIL ||
    senderAccountEmail('tallykonnect-google')
  ).trim().toLowerCase();
}

export const getGoogleAuthEmail = getGoogleSenderEmail;

function readLegacySavedTokens(senderAccountKey?: SenderAccountKey): StoredGoogleTokens | null {
  if (coerceStoredSenderAccountKey(senderAccountKey) !== 'tallykonnect-google') return null;
  if (!fs.existsSync(TOKENS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
  } catch (e) {
    console.error('Failed to parse saved Google tokens:', e);
    return null;
  }
}

async function findGoogleAuthRecord(senderAccountKey: SenderAccountKey) {
  const email = getGoogleSenderEmail(senderAccountKey);
  const googleAuth = prisma.googleAuth as any;

  if (typeof googleAuth.findFirst === 'function') {
    return googleAuth.findFirst({
      where: {
        OR: [{ senderAccountKey }, { email }]
      }
    });
  }

  if (typeof googleAuth.findUnique === 'function') {
    const bySender = await googleAuth.findUnique({ where: { senderAccountKey } }).catch(() => null);
    if (bySender) return bySender;
    return googleAuth.findUnique({ where: { email } });
  }

  return null;
}

async function saveTokens(tokens: StoredGoogleTokens, senderAccountKey?: SenderAccountKey) {
  const normalizedSender = coerceStoredSenderAccountKey(senderAccountKey);
  const email = getGoogleSenderEmail(normalizedSender);
  const existing = await findGoogleAuthRecord(normalizedSender);
  const refreshToken = tokens.refresh_token || existing?.refreshToken || null;

  const data = {
    senderAccountKey: normalizedSender,
    email,
    accessToken: tokens.access_token || existing?.accessToken || null,
    refreshToken,
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : existing?.expiryDate || null
  };

  if (existing) {
    await prisma.googleAuth.update({
      where: { id: existing.id },
      data
    });
    return;
  }

  const googleAuth = prisma.googleAuth as any;
  if (typeof googleAuth.upsert === 'function') {
    await googleAuth.upsert({
      where: { email },
      update: data,
      create: data
    });
    return;
  }

  await googleAuth.create({ data });
}

async function readSavedTokens(senderAccountKey?: SenderAccountKey): Promise<StoredGoogleTokens | null> {
  const normalizedSender = coerceStoredSenderAccountKey(senderAccountKey);
  const record = await findGoogleAuthRecord(normalizedSender);
  if (record) {
    if (!record.senderAccountKey && typeof (prisma.googleAuth as any).update === 'function') {
      await prisma.googleAuth.update({
        where: { id: record.id },
        data: { senderAccountKey: normalizedSender }
      }).catch(() => undefined);
    }
    return {
      access_token: record.accessToken,
      refresh_token: record.refreshToken,
      expiry_date: record.expiryDate?.getTime() || null
    };
  }

  const legacyTokens = readLegacySavedTokens(normalizedSender);
  if (legacyTokens?.refresh_token || legacyTokens?.access_token) {
    await saveTokens(legacyTokens, normalizedSender);
    return legacyTokens;
  }

  return null;
}
// Get credentials from env or fallback configuration
export function getCredentials(senderAccountKey?: SenderAccountKey) {
  const normalized = coerceStoredSenderAccountKey(senderAccountKey);
  const isAnyWhereTally = normalized === 'anywheretally-google';
  const account = GOOGLE_SENDER_ACCOUNTS[normalized];
  const configuredRedirectUri = (
    process.env[account.redirectUriEnv] ||
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
    senderAccountKey: normalized,
    authEmail: getGoogleSenderEmail(normalized),
    clientId: (
      process.env[account.clientIdEnv] ||
      (isAnyWhereTally ? '' : process.env.GOOGLE_CLIENT_ID) ||
      ''
    ).trim(),
    clientSecret: (
      process.env[account.clientSecretEnv] ||
      (isAnyWhereTally ? '' : process.env.GOOGLE_CLIENT_SECRET) ||
      ''
    ).trim().split(/\s+/)[0] || '',
    redirectUri: redirectUri,
    envRefreshToken: (
      process.env[account.refreshTokenEnv] ||
      (isAnyWhereTally ? '' : process.env.GOOGLE_REFRESH_TOKEN) ||
      ''
    )
  };
}

function isEnvTokenSuppressed(senderAccountKey?: SenderAccountKey) {
  const statePath = authStatePathForSender(coerceStoredSenderAccountKey(senderAccountKey));
  if (!fs.existsSync(statePath)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return !!state.suppressEnvRefreshToken;
  } catch (err) {
    console.error('Failed to parse auth state:', err);
    return false;
  }
}

function setEnvTokenSuppressed(suppressed: boolean, senderAccountKey?: SenderAccountKey) {
  const statePath = authStatePathForSender(coerceStoredSenderAccountKey(senderAccountKey));
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

function normalizeGoogleEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

async function getAuthenticatedGoogleEmail(oauth2Client: any) {
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const response = await oauth2.userinfo.get();
  const email = normalizeGoogleEmail(response.data.email);
  if (!email) {
    throw new Error('Google did not return the connected account email.');
  }
  return email;
}

async function revokeReceivedCredentials(oauth2Client: any, tokens: StoredGoogleTokens) {
  try {
    if (typeof oauth2Client.revokeCredentials === 'function') {
      await oauth2Client.revokeCredentials();
      return;
    }
    const token = tokens.access_token || tokens.refresh_token;
    if (token && typeof oauth2Client.revokeToken === 'function') {
      await oauth2Client.revokeToken(token);
    }
  } catch (error) {
    console.warn('Failed to revoke mismatched Google OAuth credentials:', error);
  }
}

export async function getOAuthClient(senderAccountKey?: SenderAccountKey) {
  const { clientId, clientSecret, redirectUri, envRefreshToken } = getCredentials(senderAccountKey);
  
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  const savedTokens = await readSavedTokens(senderAccountKey);

  if (savedTokens && savedTokens.refresh_token) {
    oauth2Client.setCredentials({
      refresh_token: savedTokens.refresh_token,
      access_token: savedTokens.access_token || undefined,
      expiry_date: savedTokens.expiry_date || undefined
    });
  } else if (envRefreshToken && !isEnvTokenSuppressed(senderAccountKey)) {
    oauth2Client.setCredentials({
      refresh_token: envRefreshToken
    });
  }

  // Handle token refreshing events to automatically persist them
  oauth2Client.on('tokens', async (tokens) => {
    try {
      const existing = await readSavedTokens(senderAccountKey);
      const updated = {
        ...existing,
        ...tokens,
        // Make sure refresh_token is kept if the refresh event doesn't supply a new one
        refresh_token: tokens.refresh_token || existing?.refresh_token || envRefreshToken
      };
      await saveTokens(updated, senderAccountKey);
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
    return `${action} failed: ${GOOGLE_RECONNECT_MESSAGE}`;
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

function isInsufficientScopeError(error: any) {
  const status = error?.code || error?.response?.status;
  const details = [
    error?.response?.data?.error?.message,
    error?.response?.data?.error_description,
    error?.message
  ]
    .filter(Boolean)
    .join(' ');

  return status === 403 && /insufficient|scope/i.test(details);
}

function hashOAuthState(state: string) {
  return createHash('sha256').update(state).digest('hex');
}

export async function createGoogleOAuthState(senderAccountKey: SenderAccountKey) {
  const state = randomBytes(32).toString('base64url');
  await prisma.googleOAuthState.create({
    data: {
      stateHash: hashOAuthState(state),
      senderAccountKey,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    }
  });
  return state;
}

export async function consumeGoogleOAuthState(state: string) {
  const stateHash = hashOAuthState(state);
  const record = await prisma.googleOAuthState.findUnique({ where: { stateHash } });
  if (!record || record.consumedAt || record.expiresAt.getTime() < Date.now()) {
    const error = new Error('OAuth state expired or invalid.');
    (error as any).statusCode = 400;
    (error as any).code = 'INVALID_OAUTH_STATE';
    throw error;
  }

  const consumed = await prisma.googleOAuthState.updateMany({
    where: {
      stateHash,
      consumedAt: null,
      expiresAt: { gt: new Date() }
    },
    data: { consumedAt: new Date() }
  });

  if (consumed.count !== 1) {
    const error = new Error('OAuth state has already been used.');
    (error as any).statusCode = 400;
    (error as any).code = 'INVALID_OAUTH_STATE';
    throw error;
  }

  return parseSenderAccountKey(record.senderAccountKey);
}

export async function createSenderAuthUrl(senderAccountKey: SenderAccountKey) {
  const { clientId, clientSecret, redirectUri, authEmail } = getCredentials(senderAccountKey);
  if (!clientId || !clientSecret) return '';
  const state = await createGoogleOAuthState(senderAccountKey);
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_OAUTH_SCOPES,
    state,
    prompt: 'consent',
    login_hint: authEmail
  });
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

async function sendRawGmailMessage(raw: string, senderAccountKey: SenderAccountKey) {
  const oauth2Client = await getOAuthClient(senderAccountKey);
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
  senderAccountKey: unknown
) {
  const senderKey = coerceStoredSenderAccountKey(senderAccountKey);
  try {
    const encodedMessage = buildRawEmail({
      to,
      fromEmail: getGoogleSenderEmail(senderKey),
      fromName: senderAccountFromName(senderKey),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, senderKey);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail email retry'));
  }
}

function calendarBrandCopy(brand?: EmailBrandKey) {
  const normalized = coerceStoredEmailBrand(brand);
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

export async function scheduleMeeting(row: ExcelRow, senderAccountKey?: unknown, emailBrandKey?: EmailBrandKey) {
  const senderKey = coerceStoredSenderAccountKey(senderAccountKey);
  const templateBrand = emailBrandKey || defaultEmailBrandForSenderAccount(senderKey);
  try {
    const oauth2Client = await getOAuthClient(senderKey);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const dateVal = row['Date of Demo'];
    const timeVal = row['Time of Demo'];
    
    const startTime = parseExcelDateTime(dateVal, timeVal);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 mins later
    
    const attendees = [{ email: row.email }];
    const brandCopy = calendarBrandCopy(templateBrand);

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

export async function updateCalendarMeeting(
  row: ExcelRow,
  calendarEventId: string,
  senderAccountKey?: unknown,
  emailBrandKey?: EmailBrandKey
) {
  const senderKey = coerceStoredSenderAccountKey(senderAccountKey);
  const templateBrand = emailBrandKey || defaultEmailBrandForSenderAccount(senderKey);
  if (!calendarEventId) {
    throw new Error('Calendar event ID is required to reschedule this demo.');
  }

  try {
    const oauth2Client = await getOAuthClient(senderKey);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const startTime = parseExcelDateTime(row['Date of Demo'], row['Time of Demo']);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
    const brandCopy = calendarBrandCopy(templateBrand);

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

export async function cancelCalendarMeeting(
  calendarEventId: string,
  senderAccountKey?: unknown
) {
  const senderKey = coerceStoredSenderAccountKey(senderAccountKey);
  if (!calendarEventId) {
    throw new Error('Calendar event ID is required to cancel this demo.');
  }

  try {
    const oauth2Client = await getOAuthClient(senderKey);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    await withCalendarRetry(() =>
      calendar.events.delete({
        calendarId: 'primary',
        eventId: calendarEventId,
        sendUpdates: 'all'
      })
    );

    return { cancelled: true as const, alreadyDeleted: false as const };
  } catch (err: any) {
    const status = err?.response?.status || err?.status || err?.code;
    if (status === 404 || status === 410) {
      return { cancelled: true as const, alreadyDeleted: true as const };
    }
    const details = getGoogleErrorDetails(err);
    console.error('CALENDAR_EVENT_CANCEL_FAILED', details);
    throw new Error(friendlyGoogleError(err, 'Calendar event cancellation'));
  }
}

type EmailSendContext = {
  row: ExcelRow;
  meetLink?: string;
  previous?: { date?: string; time?: string };
  fullName?: string;
  email?: string;
  dateStr?: string;
  timeStr?: string;
  senderAccountKey: SenderAccountKey;
  emailBrandKey: EmailBrandKey;
};

function isEmailSendContext(value: ExcelRow | EmailSendContext | unknown): value is EmailSendContext {
  return (
    !!value &&
    typeof value === 'object' &&
    'row' in value &&
    'senderAccountKey' in value &&
    'emailBrandKey' in value
  );
}

function emailContextFromLegacy(senderAccountKey: SenderAccountKey, emailBrandKey?: EmailBrandKey) {
  const normalizedSender = coerceStoredSenderAccountKey(senderAccountKey);
  return {
    senderAccountKey: normalizedSender,
    emailBrandKey: emailBrandKey || defaultEmailBrandForSenderAccount(normalizedSender)
  };
}

export async function sendThankYouEmail(rowOrInput: ExcelRow | EmailSendContext, legacyBrand?: EmailBrandKey) {
  const row = isEmailSendContext(rowOrInput) ? rowOrInput.row : rowOrInput;
  const { senderAccountKey, emailBrandKey } =
    isEmailSendContext(rowOrInput)
      ? rowOrInput
      : emailContextFromLegacy(coerceStoredSenderAccountKey(legacyBrand), legacyBrand);
  try {
    const template = buildThankYouEmail({
      fullName: row.full_name,
      brand: emailBrandKey
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      fromEmail: getGoogleSenderEmail(senderAccountKey),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, senderAccountKey);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail thank-you email'));
  }
}

export async function sendNoResponseEmail(rowOrInput: ExcelRow | EmailSendContext, legacyBrand?: EmailBrandKey) {
  const row = isEmailSendContext(rowOrInput) ? rowOrInput.row : rowOrInput;
  const { senderAccountKey, emailBrandKey } =
    isEmailSendContext(rowOrInput)
      ? rowOrInput
      : emailContextFromLegacy(coerceStoredSenderAccountKey(legacyBrand), legacyBrand);
  try {
    const template = buildNoResponseEmail({
      fullName: row.full_name,
      brand: emailBrandKey
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      fromEmail: getGoogleSenderEmail(senderAccountKey),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, senderAccountKey);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail Not Attended email'));
  }
}

export async function sendGmailInvite(
  rowOrInput: ExcelRow | EmailSendContext,
  meetLink?: string,
  legacySenderAccountKey?: unknown,
  legacyEmailBrandKey?: EmailBrandKey
) {
  const row = isEmailSendContext(rowOrInput) ? rowOrInput.row : rowOrInput;
  const resolvedMeetLink = isEmailSendContext(rowOrInput) ? rowOrInput.meetLink || '' : meetLink || '';
  const { senderAccountKey, emailBrandKey } =
    isEmailSendContext(rowOrInput)
      ? rowOrInput
      : emailContextFromLegacy(coerceStoredSenderAccountKey(legacySenderAccountKey), legacyEmailBrandKey);
  try {
    const template = buildMeetingInviteEmail({
      fullName: row.full_name,
      date: String(row['Date of Demo'] || ''),
      time: String(row['Time of Demo'] || ''),
      meetLink: resolvedMeetLink,
      brand: emailBrandKey
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      fromEmail: getGoogleSenderEmail(senderAccountKey),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, senderAccountKey);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail invitation'));
  }
}

export async function sendGmailRescheduleInvite(
  rowOrInput: ExcelRow | EmailSendContext,
  meetLink?: string,
  previous?: { date?: string; time?: string } | undefined,
  legacySenderAccountKey?: unknown,
  legacyEmailBrandKey?: EmailBrandKey
) {
  const row = isEmailSendContext(rowOrInput) ? rowOrInput.row : rowOrInput;
  const resolvedMeetLink = isEmailSendContext(rowOrInput) ? rowOrInput.meetLink || '' : meetLink || '';
  const resolvedPrevious = isEmailSendContext(rowOrInput) ? rowOrInput.previous : previous;
  const { senderAccountKey, emailBrandKey } =
    isEmailSendContext(rowOrInput)
      ? rowOrInput
      : emailContextFromLegacy(coerceStoredSenderAccountKey(legacySenderAccountKey), legacyEmailBrandKey);
  try {
    const template = buildRescheduleEmail({
      fullName: row.full_name,
      date: String(row['Date of Demo'] || ''),
      time: String(row['Time of Demo'] || ''),
      meetLink: resolvedMeetLink,
      oldDate: resolvedPrevious?.date,
      oldTime: resolvedPrevious?.time,
      brand: emailBrandKey
    });
    const encodedMessage = buildRawEmail({
      to: String(row.email || ''),
      fromEmail: getGoogleSenderEmail(senderAccountKey),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, senderAccountKey);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail reschedule invitation'));
  }
}

export async function sendGmailReminder(
  fullNameOrInput: string | EmailSendContext,
  email?: string,
  dateStr?: string,
  timeStr?: string,
  meetLink?: string,
  legacySenderAccountKey?: unknown,
  legacyEmailBrandKey?: EmailBrandKey
) {
  const input: EmailSendContext | {
    fullName: string;
    email: string;
    dateStr: string;
    timeStr: string;
    meetLink: string;
    senderAccountKey: SenderAccountKey;
    emailBrandKey: EmailBrandKey;
  } =
    typeof fullNameOrInput === 'string'
      ? {
          fullName: fullNameOrInput,
          email: String(email || ''),
          dateStr: String(dateStr || ''),
          timeStr: String(timeStr || ''),
          meetLink: String(meetLink || ''),
          ...emailContextFromLegacy(coerceStoredSenderAccountKey(legacySenderAccountKey), legacyEmailBrandKey)
      }
      : fullNameOrInput;
  const row = isEmailSendContext(input) ? input.row : undefined;
  try {
    const template = buildReminderEmail({
      fullName: input.fullName || row?.full_name,
      date: input.dateStr || '',
      time: input.timeStr || '',
      meetLink: input.meetLink || '',
      brand: input.emailBrandKey
    });
    const encodedMessage = buildRawEmail({
      to: input.email || String(row?.email || ''),
      fromEmail: getGoogleSenderEmail(input.senderAccountKey),
      ...template
    });

    return await sendRawGmailMessage(encodedMessage, input.senderAccountKey);
  } catch (err: any) {
    throw new Error(friendlyGoogleError(err, 'Gmail reminder email'));
  }
}

// Check tokens save status to determine authorization validity
export async function getSenderAuthStatus(senderAccountKey: unknown) {
  const normalizedSender = parseSenderAccountKey(senderAccountKey);
  const { clientId, clientSecret, redirectUri, envRefreshToken, authEmail } = getCredentials(normalizedSender);
  const configured = !!(clientId && clientSecret);
  let envTokenSuppressed = isEnvTokenSuppressed(normalizedSender);
  
  let authenticated = false;
  let isUsingEnvToken = false;
  let requiresReconnect = false;
  let authError: string | undefined;
  let connectedEmail: string | undefined;

  const savedTokens = await readSavedTokens(normalizedSender);
  const hasSavedToken = !!savedTokens?.refresh_token;
  const hasEnvToken = !!(envRefreshToken && !envTokenSuppressed);

  if (configured && (hasSavedToken || hasEnvToken)) {
    try {
      const oauth2Client = await getOAuthClient(normalizedSender);
      await oauth2Client.getAccessToken();
      connectedEmail = await getAuthenticatedGoogleEmail(oauth2Client);
      if (connectedEmail !== authEmail) {
        await clearSenderCredentials(normalizedSender);
        envTokenSuppressed = true;
        requiresReconnect = true;
        authError = `${GOOGLE_SENDER_ACCOUNTS[normalizedSender].displayName} must be connected using ${authEmail}.`;
      } else {
        authenticated = true;
        isUsingEnvToken = !hasSavedToken && hasEnvToken;
      }
    } catch (error: any) {
      if (isInvalidGrantError(error)) {
        await clearSenderCredentials(normalizedSender);
        envTokenSuppressed = true;
        requiresReconnect = true;
        authError = GOOGLE_RECONNECT_MESSAGE;
      } else if (isInsufficientScopeError(error)) {
        await clearSenderCredentials(normalizedSender);
        envTokenSuppressed = true;
        requiresReconnect = true;
        authError = 'Google account identity permission missing. Reconnect this Google account.';
      } else if (error?.code === 'GOOGLE_ACCOUNT_MISMATCH') {
        await clearSenderCredentials(normalizedSender);
        envTokenSuppressed = true;
        requiresReconnect = true;
        connectedEmail = error.connectedEmail;
        authError = error.message;
      } else {
        authError = error?.message || 'Google authentication check failed.';
      }
    }
  }

  const authUrl = configured ? await createSenderAuthUrl(normalizedSender) : '';

  return {
    key: normalizedSender,
    senderAccountKey: normalizedSender,
    brand: defaultEmailBrandForSenderAccount(normalizedSender),
    displayName: GOOGLE_SENDER_ACCOUNTS[normalizedSender].displayName,
    email: authEmail,
    expectedEmail: authEmail,
    configured,
    authenticated,
    clientId: clientId ? `${clientId.slice(0, 10)}...` : undefined,
    redirectUri,
    authUrl,
    connectedEmail,
    isUsingEnvToken,
    envTokenSuppressed,
    requiresReconnect,
    authError
  };
}

export const getAuthStatus = getSenderAuthStatus;

// Exchange callback authorization code for tokens and save
export async function exchangeCodeAndSave(code: string, senderAccountKey: unknown) {
  const normalizedSender = parseSenderAccountKey(senderAccountKey);
  const { clientId, clientSecret, redirectUri, authEmail } = getCredentials(normalizedSender);
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  const connectedEmail = await getAuthenticatedGoogleEmail(oauth2Client);

  if (connectedEmail !== authEmail) {
    await revokeReceivedCredentials(oauth2Client, tokens);
    throw new GoogleAccountMismatchError(normalizedSender, authEmail, connectedEmail);
  }
  
  const existing = await readSavedTokens(normalizedSender);
  const updated: StoredGoogleTokens = {
    ...existing,
    ...tokens
  };

  await saveTokens(updated, normalizedSender);
  setEnvTokenSuppressed(false, normalizedSender);
  console.log(`Saved Google Auth tokens for ${getGoogleSenderEmail(normalizedSender)} directly from exchangeCodeAndSave.`);
  return updated;
}

export async function exchangeCodeAndSaveFromState(code: string, state: string) {
  const senderAccountKey = await consumeGoogleOAuthState(state);
  await exchangeCodeAndSave(code, senderAccountKey);
  return senderAccountKey;
}

export async function clearSenderCredentials(senderAccountKey: unknown) {
  const normalizedSender = parseSenderAccountKey(senderAccountKey);
  await prisma.googleAuth.deleteMany({
    where: {
      OR: [
        { senderAccountKey: normalizedSender },
        { email: getGoogleSenderEmail(normalizedSender) }
      ]
    }
  });
  if (normalizedSender === 'tallykonnect-google' && fs.existsSync(TOKENS_PATH)) {
    fs.unlinkSync(TOKENS_PATH);
  }
  console.log('Google Auth tokens cleared.');
  setEnvTokenSuppressed(true, normalizedSender);
  console.log('Environment refresh token disabled for this local session.');
}

export const clearCredentials = clearSenderCredentials;

export async function listGoogleSenderAccounts() {
  const accounts = await Promise.all(
    SENDER_ACCOUNT_KEYS.map(async (key) => {
      const status = await getSenderAuthStatus(key);
      return {
        key,
        displayName: GOOGLE_SENDER_ACCOUNTS[key].displayName,
        expectedEmail: status.expectedEmail,
        email: status.expectedEmail,
        configured: status.configured,
        authenticated: status.authenticated,
        connected: status.authenticated,
        connectedEmail: status.connectedEmail,
        requiresReconnect: status.requiresReconnect,
        authError: status.authError
      };
    })
  );
  return accounts;
}
