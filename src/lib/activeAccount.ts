import type { EmailBrandKey } from './emailBrand';
import type { SenderAccountKey, WorkspaceKey } from './senderAccount';

export type ActiveAccountKey = 'tallykonnect' | 'anywheretally';

export type ActiveAccountDefinition = {
  key: ActiveAccountKey;
  label: string;
  workspaceKey: WorkspaceKey;
  emailBrand: EmailBrandKey;
  senderAccountKey: SenderAccountKey;
  googleAccountKey: SenderAccountKey;
  expectedGoogleEmail: string;
  accentClass: string;
};

export const ACTIVE_ACCOUNTS: Record<ActiveAccountKey, ActiveAccountDefinition> = {
  tallykonnect: {
    key: 'tallykonnect',
    label: 'TallyKonnect',
    workspaceKey: 'tallykonnect',
    emailBrand: 'tallykonnect',
    senderAccountKey: 'tallykonnect-google',
    googleAccountKey: 'tallykonnect-google',
    expectedGoogleEmail: 'demo.tallykonnect@gmail.com',
    accentClass: 'from-sky-500 to-cyan-600'
  },
  anywheretally: {
    key: 'anywheretally',
    label: 'AnyWhereTally',
    workspaceKey: 'anywheretally',
    emailBrand: 'anywheretally',
    senderAccountKey: 'anywheretally-google',
    googleAccountKey: 'anywheretally-google',
    expectedGoogleEmail: 'info.anywheretally@gmail.com',
    accentClass: 'from-blue-600 to-amber-400'
  }
};

export const ACTIVE_ACCOUNT_LIST = Object.values(ACTIVE_ACCOUNTS);
export const ACTIVE_ACCOUNT_STORAGE_KEY = 'leadpilot.activeAccountKey';
export const ADVANCED_ROUTING_STORAGE_KEY = 'leadpilot.advancedRoutingEnabled';

export function parseActiveAccountKey(value: unknown): ActiveAccountKey {
  return value === 'anywheretally' ? 'anywheretally' : 'tallykonnect';
}

export function activeAccountForSender(senderAccountKey: SenderAccountKey): ActiveAccountKey {
  return senderAccountKey === 'anywheretally-google' ? 'anywheretally' : 'tallykonnect';
}
