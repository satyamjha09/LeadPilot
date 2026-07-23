import 'dotenv/config';

import { SENDER_ACCOUNT_KEYS } from '../server/googleSenderAccounts';
import { getGoogleAccountDiagnostics } from '../server/googleAuth';
import { prisma } from '../server/db';

function yesNo(value: unknown) {
  return value ? 'yes' : 'no';
}

function accountTitle(key: string) {
  return key === 'anywheretally-google' ? 'AnyWhereTally' : 'TallyKonnect';
}

async function main() {
  const requested = process.argv[2];
  const keys = requested
    ? SENDER_ACCOUNT_KEYS.filter((key) => key === requested)
    : SENDER_ACCOUNT_KEYS;

  if (requested && keys.length === 0) {
    console.error('Unknown sender account. Use tallykonnect-google or anywheretally-google.');
    process.exit(1);
  }

  let hasInvalidConfiguration = false;

  for (const key of keys) {
    const status = await getGoogleAccountDiagnostics(key, { verify: true });
    const configurationValid = !!status.configured;
    if (!configurationValid) hasInvalidConfiguration = true;

    console.log(`Account: ${accountTitle(key)}`);
    console.log(`Sender account key: ${key}`);
    console.log(`Configuration: ${configurationValid ? 'valid' : 'invalid'}`);
    console.log(`Client ID configured: ${yesNo(status.clientIdConfigured)}`);
    console.log(`Client secret configured: ${yesNo(status.clientSecretConfigured)}`);
    console.log(`Redirect URI configured: ${yesNo(status.redirectUriConfigured)}`);
    console.log(`Redirect URI HTTPS: ${yesNo(status.redirectUriIsHttps)}`);
    console.log(`Expected email: ${status.expectedEmail || 'missing'}`);
    console.log(`Database connection: ${status.refreshTokenSource === 'database' ? 'connected' : 'not connected'}`);
    console.log(`Refresh token source: ${status.refreshTokenSource}`);
    console.log(`Connected: ${yesNo(status.authenticated)}`);
    console.log(`Connected email: ${status.connectedEmail || 'none'}`);
    console.log(`Status code: ${status.statusCode}`);
    console.log(`Identity verification: ${status.capabilities?.identity === 'verified' ? 'passed' : 'not ready'}`);
    console.log(`Gmail capability: ${status.capabilities?.gmail || 'not-ready'}`);
    console.log(`Calendar capability: ${status.capabilities?.calendar || 'not-ready'}`);
    console.log(`Sheets capability: ${status.capabilities?.sheets || 'not-ready'}`);
    console.log(`Reconnect required: ${yesNo(status.requiresReconnect)}`);
    console.log('');
  }

  await prisma.$disconnect();
  process.exit(hasInvalidConfiguration ? 1 : 0);
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : 'Google doctor failed.');
  process.exit(1);
});
