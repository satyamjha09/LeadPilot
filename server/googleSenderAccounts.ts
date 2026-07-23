import {
  SENDER_ACCOUNT_KEYS,
  parseSenderAccountKey,
  senderAccountEmail,
  senderAccountLabel,
  type SenderAccountKey
} from '../src/lib/senderAccount';

export type GoogleSenderAccountConfig = {
  key: SenderAccountKey;
  displayName: string;
  expectedEmail: string;
  expectedEmailEnv: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  refreshTokenEnv: string;
  redirectUriEnv: string;
};

export const GOOGLE_SENDER_ACCOUNTS: Record<SenderAccountKey, GoogleSenderAccountConfig> = {
  'tallykonnect-google': {
    key: 'tallykonnect-google',
    displayName: senderAccountLabel('tallykonnect-google'),
    expectedEmail: senderAccountEmail('tallykonnect-google'),
    expectedEmailEnv: 'GOOGLE_TALLYKONNECT_AUTH_EMAIL',
    clientIdEnv: 'GOOGLE_TALLYKONNECT_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_TALLYKONNECT_CLIENT_SECRET',
    refreshTokenEnv: 'GOOGLE_TALLYKONNECT_REFRESH_TOKEN',
    redirectUriEnv: 'GOOGLE_TALLYKONNECT_REDIRECT_URI'
  },
  'anywheretally-google': {
    key: 'anywheretally-google',
    displayName: senderAccountLabel('anywheretally-google'),
    expectedEmail: senderAccountEmail('anywheretally-google'),
    expectedEmailEnv: 'GOOGLE_ANYWHERETALLY_AUTH_EMAIL',
    clientIdEnv: 'GOOGLE_ANYWHERETALLY_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_ANYWHERETALLY_CLIENT_SECRET',
    refreshTokenEnv: 'GOOGLE_ANYWHERETALLY_REFRESH_TOKEN',
    redirectUriEnv: 'GOOGLE_ANYWHERETALLY_REDIRECT_URI'
  }
};

export { SENDER_ACCOUNT_KEYS, parseSenderAccountKey };
export type { SenderAccountKey };

export function getGoogleSenderAccount(senderAccountKey: unknown) {
  return GOOGLE_SENDER_ACCOUNTS[parseSenderAccountKey(senderAccountKey)];
}
