import type { NormalizedReadRow, SourceValidationError } from './sourceIngestion.types';

export function buildSourceRowIdentity(automationId: string, rowNumber: number) {
  if (automationId) {
    return {
      externalRowId: `automation:${automationId}`,
      identityType: 'AUTOMATION_ID' as const,
      warning: null
    };
  }

  return {
    externalRowId: `row:${rowNumber}`,
    identityType: 'ROW_NUMBER' as const,
    warning: {
      code: 'MISSING_AUTOMATION_ID',
      field: 'automationId',
      severity: 'WARNING',
      message: 'automation_id is missing; row number identity will be used.'
    } satisfies SourceValidationError
  };
}

export function markDuplicateAutomationIds(rows: NormalizedReadRow[]) {
  const seen = new Map<string, number>();

  return rows.map((row) => {
    const automationId = row.normalizedFields.automationId;
    if (!automationId) return row;

    const count = (seen.get(automationId) || 0) + 1;
    seen.set(automationId, count);
    if (count === 1) return row;

    const validationErrors = [
      ...row.validationErrors,
      {
        code: 'DUPLICATE_AUTOMATION_ID',
        field: 'automationId',
        severity: 'ERROR',
        message: `automation_id ${automationId} appears more than once in this tab.`
      } satisfies SourceValidationError
    ];

    return {
      ...row,
      externalRowId: `duplicate-automation:${automationId}:row:${row.rowNumber}`,
      identityType: 'ROW_NUMBER' as const,
      validationErrors,
      validationStatus: 'INVALID' as const
    };
  });
}
