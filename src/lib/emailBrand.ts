export const EMAIL_BRAND_KEYS = ['tallykonnect', 'anywheretally'] as const;

export type EmailBrandKey = (typeof EMAIL_BRAND_KEYS)[number];

export class InvalidEmailBrandError extends Error {
  code = 'INVALID_EMAIL_BRAND';
  statusCode = 400;

  constructor() {
    super('emailBrand must be tallykonnect or anywheretally.');
    this.name = 'InvalidEmailBrandError';
  }
}

const EMAIL_BRAND_ALIASES: Record<string, EmailBrandKey> = {
  tallykonnect: 'tallykonnect',
  tk: 'tallykonnect',
  anywheretally: 'anywheretally',
  awt: 'anywheretally'
};

function normalizeBrandToken(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

export function parseEmailBrand(value: unknown): EmailBrandKey {
  const key = normalizeBrandToken(value);
  const brand = EMAIL_BRAND_ALIASES[key];
  if (!brand) {
    throw new InvalidEmailBrandError();
  }
  return brand;
}

export function coerceStoredEmailBrand(value: unknown): EmailBrandKey {
  try {
    return parseEmailBrand(value);
  } catch {
    return 'tallykonnect';
  }
}

export function emailBrandLabel(brand: EmailBrandKey): string {
  return brand === 'anywheretally' ? 'AnyWhereTally' : 'TallyKonnect';
}
