import type { ExcelRow } from '../src/types';
import { coerceStoredEmailBrand, type EmailBrandKey } from '../src/lib/emailBrand';
import { parseSenderAccountKey, type SenderAccountKey } from '../src/lib/senderAccount';
import { LEAD_STATUS, normalizeLeadStatus } from './leadStatus';
import { assertDemoBrandOwnership, assertDemoLifecycleOwnership } from './scheduleDb';
import {
  EmailBrandMismatchError,
  MixedEmailBrandBatchError,
  MixedSenderAccountBatchError,
  SenderAccountMismatchError
} from './brandOwnership';

const OWNER_LOCKED_STATUSES = new Set<string>([
  LEAD_STATUS.RESCHEDULE,
  LEAD_STATUS.DEMO_DONE,
  LEAD_STATUS.NO_RESPONSE
]);

function addStoredRowBrand(row: ExcelRow, lockedBrands: Set<EmailBrandKey>) {
  if (row.__emailBrand) {
    lockedBrands.add(coerceStoredEmailBrand(row.__emailBrand));
  }
}

function addStoredRowSender(row: ExcelRow, lockedSenderAccountKeys: Set<SenderAccountKey>) {
  if (row.__senderAccountKey) {
    lockedSenderAccountKeys.add(parseSenderAccountKey(row.__senderAccountKey));
  }
}

export function getStoredRowBrands(rows: ExcelRow[]) {
  const lockedBrands = new Set<EmailBrandKey>();
  rows.forEach((row) => addStoredRowBrand(row, lockedBrands));
  return Array.from(lockedBrands);
}

export function getStoredRowSenderAccountKeys(rows: ExcelRow[]) {
  const lockedSenderAccountKeys = new Set<SenderAccountKey>();
  rows.forEach((row) => addStoredRowSender(row, lockedSenderAccountKeys));
  return Array.from(lockedSenderAccountKeys);
}

export async function assertProcessBatchBrandOwnership(
  rows: ExcelRow[],
  selectedBrand: EmailBrandKey
) {
  const result = await assertProcessBatchLifecycleOwnership(rows, selectedBrand, undefined);
  return {
    selectedBrand,
    lockedBrand: result.lockedBrand,
    lockedBrands: result.lockedBrands
  };
}

export async function assertProcessBatchLifecycleOwnership(
  rows: ExcelRow[],
  selectedBrand: EmailBrandKey,
  selectedSenderAccountKey?: SenderAccountKey
) {
  const lockedBrands = new Set<EmailBrandKey>(getStoredRowBrands(rows));
  const lockedSenderAccountKeys = new Set<SenderAccountKey>(getStoredRowSenderAccountKeys(rows));

  for (const row of rows) {
    const normalized = normalizeLeadStatus(row.lead_status);
    if (!OWNER_LOCKED_STATUSES.has(normalized)) continue;
    const active = selectedSenderAccountKey
      ? await assertDemoLifecycleOwnership(row, selectedBrand, selectedSenderAccountKey)
      : await assertDemoBrandOwnership(row, selectedBrand);
    lockedBrands.add(active.emailBrand);
    lockedSenderAccountKeys.add(active.senderAccountKey);
  }

  const brands = Array.from(lockedBrands);
  const senderAccountKeys = Array.from(lockedSenderAccountKeys);
  if (brands.length > 1) {
    throw new MixedEmailBrandBatchError(brands);
  }
  if (senderAccountKeys.length > 1) {
    throw new MixedSenderAccountBatchError(senderAccountKeys);
  }

  const lockedBrand = brands[0];
  if (lockedBrand && lockedBrand !== selectedBrand) {
    throw new EmailBrandMismatchError(lockedBrand, selectedBrand);
  }
  const lockedSenderAccountKey = senderAccountKeys[0];
  if (lockedSenderAccountKey && selectedSenderAccountKey && lockedSenderAccountKey !== selectedSenderAccountKey) {
    throw new SenderAccountMismatchError(lockedSenderAccountKey, selectedSenderAccountKey);
  }

  return {
    selectedBrand,
    selectedSenderAccountKey,
    lockedBrand,
    lockedBrands: brands,
    lockedSenderAccountKey,
    lockedSenderAccountKeys: senderAccountKeys
  };
}
