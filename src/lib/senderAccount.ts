import { type EmailBrandKey } from './emailBrand';

export const SENDER_ACCOUNT_KEYS = ['tallykonnect-google', 'anywheretally-google'] as const;

export type SenderAccountKey = (typeof SENDER_ACCOUNT_KEYS)[number];
export type WorkspaceKey = EmailBrandKey;

export class InvalidSenderAccountError extends Error {
  code = 'INVALID_GOOGLE_SENDER_ACCOUNT';
  statusCode = 400;

  constructor() {
    super('senderAccountKey must be tallykonnect-google or anywheretally-google.');
    this.name = 'InvalidSenderAccountError';
  }
}

const SENDER_ACCOUNT_ALIASES: Record<string, SenderAccountKey> = {
  tallykonnectgoogle: 'tallykonnect-google',
  tallykonnect: 'tallykonnect-google',
  tk: 'tallykonnect-google',
  demotallykonnect: 'tallykonnect-google',
  demotallykonnectgmailcom: 'tallykonnect-google',
  anywheretallygoogle: 'anywheretally-google',
  anywheretally: 'anywheretally-google',
  awt: 'anywheretally-google',
  infoanywheretally: 'anywheretally-google',
  infoanywheretallygmailcom: 'anywheretally-google'
};

function normalizeSenderToken(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[@.]/g, '')
    .replace(/[\s_-]+/g, '');
}

export function parseSenderAccountKey(value: unknown): SenderAccountKey {
  const key = normalizeSenderToken(value);
  const account = SENDER_ACCOUNT_ALIASES[key];
  if (!account) {
    throw new InvalidSenderAccountError();
  }
  return account;
}

export function coerceStoredSenderAccountKey(value: unknown): SenderAccountKey {
  try {
    return parseSenderAccountKey(value);
  } catch {
    return 'tallykonnect-google';
  }
}

export function senderAccountEmail(senderAccountKey: SenderAccountKey) {
  return senderAccountKey === 'anywheretally-google'
    ? 'info.anywheretally@gmail.com'
    : 'demo.tallykonnect@gmail.com';
}

export function senderAccountLabel(senderAccountKey: SenderAccountKey) {
  return senderAccountKey === 'anywheretally-google'
    ? 'AnyWhereTally Google account'
    : 'TallyKonnect Google account';
}

export function senderAccountFromName(senderAccountKey: SenderAccountKey) {
  return senderAccountKey === 'anywheretally-google' ? 'AnyWhereTally' : 'TallyKonnect';
}

export const DEFAULT_SENDER_ACCOUNT_BY_BRAND: Record<EmailBrandKey, SenderAccountKey> = {
  tallykonnect: 'tallykonnect-google',
  anywheretally: 'anywheretally-google'
};

export function defaultSenderAccountForBrand(brand: EmailBrandKey): SenderAccountKey {
  return DEFAULT_SENDER_ACCOUNT_BY_BRAND[brand];
}

export function defaultEmailBrandForSenderAccount(senderAccountKey: SenderAccountKey): EmailBrandKey {
  return senderAccountKey === 'anywheretally-google' ? 'anywheretally' : 'tallykonnect';
}
