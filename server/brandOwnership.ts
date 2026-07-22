import { emailBrandLabel, type EmailBrandKey } from '../src/lib/emailBrand';
import { senderAccountLabel, type SenderAccountKey } from '../src/lib/senderAccount';

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

export class SenderAccountMismatchError extends Error {
  code = 'SENDER_ACCOUNT_MISMATCH';
  statusCode = 409;

  constructor(
    public requiredSenderAccountKey: SenderAccountKey,
    public selectedSenderAccountKey: SenderAccountKey
  ) {
    super(`This demo is owned by ${senderAccountLabel(requiredSenderAccountKey)}. Switch to that connected sender account before continuing.`);
    this.name = 'SenderAccountMismatchError';
  }
}

export class MixedSenderAccountBatchError extends Error {
  code = 'MIXED_SENDER_ACCOUNT_BATCH';
  statusCode = 409;

  constructor(public senderAccountKeys: SenderAccountKey[]) {
    super(`This batch contains rows from multiple sender accounts (${senderAccountKeys.map(senderAccountLabel).join(', ')}). Process each sender account separately.`);
    this.name = 'MixedSenderAccountBatchError';
  }
}
