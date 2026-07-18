import { emailBrandLabel, type EmailBrandKey } from '../src/lib/emailBrand';

export class EmailBrandMismatchError extends Error {
  code = 'EMAIL_BRAND_MISMATCH';
  statusCode = 409;

  constructor(
    public requiredBrand: EmailBrandKey,
    public selectedBrand: EmailBrandKey
  ) {
    super(`This demo belongs to ${emailBrandLabel(requiredBrand)}. Switch the sender to ${emailBrandLabel(requiredBrand)}.`);
    this.name = 'EmailBrandMismatchError';
  }
}

export class MixedEmailBrandBatchError extends Error {
  code = 'MIXED_EMAIL_BRAND_BATCH';
  statusCode = 409;

  constructor(public brands: EmailBrandKey[]) {
    super(`This batch contains rows from multiple brands (${brands.map(emailBrandLabel).join(', ')}). Process each brand separately.`);
    this.name = 'MixedEmailBrandBatchError';
  }
}
