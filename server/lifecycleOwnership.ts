import type { ExcelRow } from '../src/types';
import { coerceStoredEmailBrand, type EmailBrandKey } from '../src/lib/emailBrand';
import { LEAD_STATUS, normalizeLeadStatus } from './leadStatus';
import { assertDemoBrandOwnership } from './scheduleDb';
import { EmailBrandMismatchError, MixedEmailBrandBatchError } from './brandOwnership';

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

export function getStoredRowBrands(rows: ExcelRow[]) {
  const lockedBrands = new Set<EmailBrandKey>();
  rows.forEach((row) => addStoredRowBrand(row, lockedBrands));
  return Array.from(lockedBrands);
}

export async function assertProcessBatchBrandOwnership(
  rows: ExcelRow[],
  selectedBrand: EmailBrandKey
) {
  const lockedBrands = new Set<EmailBrandKey>(getStoredRowBrands(rows));

  for (const row of rows) {
    const normalized = normalizeLeadStatus(row.lead_status);
    if (!OWNER_LOCKED_STATUSES.has(normalized)) continue;
    const active = await assertDemoBrandOwnership(row, selectedBrand);
    lockedBrands.add(active.emailBrand);
  }

  const brands = Array.from(lockedBrands);
  if (brands.length > 1) {
    throw new MixedEmailBrandBatchError(brands);
  }

  const lockedBrand = brands[0];
  if (lockedBrand && lockedBrand !== selectedBrand) {
    throw new EmailBrandMismatchError(lockedBrand, selectedBrand);
  }

  return {
    selectedBrand,
    lockedBrand,
    lockedBrands: brands
  };
}
