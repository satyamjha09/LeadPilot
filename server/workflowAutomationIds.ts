import type { ExcelRow } from '../src/types';
import { type EmailBrandKey } from '../src/lib/emailBrand';
import { type SenderAccountKey } from '../src/lib/senderAccount';
import { createNewAutomationId } from './emailIdentity';
import { findLeadSchedule } from './scheduleDb';
import {
  friendlySheetsError,
  googleSheetAccessForWorkspace,
  updateGoogleSheetRowsBatch,
  type GoogleSheetAccessContext
} from './googleSheets';

export class MissingPermanentAutomationIdError extends Error {
  constructor(message = 'Permanent automation_id is required before processing workflow rows.') {
    super(message);
    this.name = 'MissingPermanentAutomationIdError';
  }
}

export type WorkflowAutomationIdContext = {
  sourceType: 'excel' | 'google-sheet';
  spreadsheetId?: string;
  sheetName?: string;
  headers?: string[];
  workspaceKey: EmailBrandKey;
  emailBrand: EmailBrandKey;
  googleAccountKey?: SenderAccountKey;
};

function sheetRowNumber(row: ExcelRow) {
  return Number(row.__sheetRowNumber || row.__sourceRowNumber || 0);
}

function currentAutomationId(row: ExcelRow) {
  return String(row.automation_id || row.automationId || '').trim();
}

async function resolveAutomationId(row: ExcelRow, emailBrand: EmailBrandKey) {
  const existing = currentAutomationId(row);
  if (existing) return existing;

  const schedule = await findLeadSchedule(row, emailBrand);
  const restored = String(schedule?.automationId || '').trim();
  if (restored) return restored;

  return createNewAutomationId();
}

export async function ensureWorkflowAutomationIds(
  rows: ExcelRow[],
  context: WorkflowAutomationIdContext
) {
  const updates: Array<{ rowNumber: number; values: Record<string, any> }> = [];
  const resolvedRows: ExcelRow[] = [];

  for (const row of rows) {
    const existing = currentAutomationId(row);
    const automationId = existing || await resolveAutomationId(row, context.emailBrand);
    const updatedRow: ExcelRow = {
      ...row,
      automation_id: automationId
    };

    if (!existing && context.sourceType === 'google-sheet') {
      const rowNumber = sheetRowNumber(updatedRow);
      if (!rowNumber || rowNumber < 2) {
        throw new MissingPermanentAutomationIdError(
          'Could not save permanent automation_id because the Google Sheet row number is missing.'
        );
      }
      updates.push({
        rowNumber,
        values: { automation_id: automationId }
      });
    }

    resolvedRows.push(updatedRow);
  }

  if (context.sourceType === 'google-sheet' && updates.length > 0) {
    if (!context.spreadsheetId || !context.sheetName || !context.headers?.length) {
      throw new MissingPermanentAutomationIdError(
        'Could not save permanent automation_id because Google Sheet context is incomplete.'
      );
    }

    const access: GoogleSheetAccessContext = context.googleAccountKey
      ? { workspaceKey: context.workspaceKey, googleAccountKey: context.googleAccountKey }
      : googleSheetAccessForWorkspace(context.workspaceKey);

    try {
      await updateGoogleSheetRowsBatch(
        context.spreadsheetId,
        context.sheetName,
        context.headers,
        updates,
        access
      );
    } catch (err) {
      const friendly = friendlySheetsError(err);
      throw new MissingPermanentAutomationIdError(
        `Could not save permanent automation_id to Google Sheet. No email or meeting was created. ${friendly.message}`
      );
    }
  }

  return resolvedRows;
}

export function assertWorkflowAutomationIds(rows: ExcelRow[]) {
  const missing = rows.find((row) => !currentAutomationId(row));
  if (missing) {
    throw new MissingPermanentAutomationIdError();
  }
}
