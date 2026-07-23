import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExcelRow } from '../src/types';
import { ensureWorkflowAutomationIds } from './workflowAutomationIds';
import { updateGoogleSheetRowsBatch } from './googleSheets';
import { resolvePermanentAutomationId } from './modules/lead/identity/permanentAutomationId.service';

vi.mock('./modules/lead/identity/permanentAutomationId.service', () => {
  class MissingPermanentAutomationIdError extends Error {
    code = 'MISSING_PERMANENT_AUTOMATION_ID';
    statusCode = 400;
  }
  class AutomationIdentityConflictError extends Error {
    code = 'AUTOMATION_IDENTITY_CONFLICT';
    statusCode = 409;
    automationIds: string[];
    constructor(automationIds: string[]) {
      super('Multiple automation_id values match this lead. Manual review is required.');
      this.automationIds = automationIds;
    }
  }
  return {
    MissingPermanentAutomationIdError,
    AutomationIdentityConflictError,
    resolvePermanentAutomationId: vi.fn()
  };
});

vi.mock('./googleSheets', () => ({
  friendlySheetsError: vi.fn((error: any) => ({ status: 500, message: error?.message || 'Sheet write failed' })),
  googleSheetAccessForWorkspace: vi.fn((workspaceKey: string) => ({ workspaceKey })),
  updateGoogleSheetRowsBatch: vi.fn()
}));

const baseRow = {
  id: 'row-1',
  full_name: 'Moh Agarwal',
  email: 'moh@example.com',
  lead_status: 'Demo Scheduled',
  'Date of Demo': '23-07-2026',
  'Time of Demo': '14:00',
  __sheetRowNumber: 2
} satisfies ExcelRow;

describe('ensureWorkflowAutomationIds', () => {
  beforeEach(() => {
    vi.mocked(resolvePermanentAutomationId).mockReset();
    vi.mocked(updateGoogleSheetRowsBatch).mockReset();
    vi.mocked(resolvePermanentAutomationId).mockImplementation(async ({ row }: any) => ({
      automationId: row.automation_id || 'lead_generated',
      canonicalLeadId: 'canonical-1',
      sourceRowId: row.__sourceRowId
    }));
    vi.mocked(updateGoogleSheetRowsBatch).mockResolvedValue(undefined);
  });

  it('creates a permanent automation_id before processing Excel rows', async () => {
    const [row] = await ensureWorkflowAutomationIds([baseRow], {
      sourceType: 'excel',
      workspaceKey: 'tallykonnect',
      emailBrand: 'tallykonnect'
    });

    expect(row.automation_id).toBe('lead_generated');
    expect(row.__canonicalLeadId).toBe('canonical-1');
    expect(updateGoogleSheetRowsBatch).not.toHaveBeenCalled();
  });

  it('restores the service-resolved permanent automation_id before processing', async () => {
    vi.mocked(resolvePermanentAutomationId).mockResolvedValue({
      automationId: 'lead_existing',
      canonicalLeadId: 'canonical-restored',
      sourceRowId: 'source-row-1'
    });

    const [row] = await ensureWorkflowAutomationIds([baseRow], {
      sourceType: 'excel',
      workspaceKey: 'anywheretally',
      emailBrand: 'anywheretally'
    });

    expect(row.automation_id).toBe('lead_existing');
    expect(row.__canonicalLeadId).toBe('canonical-restored');
  });

  it('writes missing Google Sheet automation IDs before processing', async () => {
    const [row] = await ensureWorkflowAutomationIds([baseRow], {
      sourceType: 'google-sheet',
      spreadsheetId: 'sheet-1',
      sheetName: 'Leads',
      headers: ['full_name', 'email', 'lead_status', 'Remarks', 'automation_id'],
      workspaceKey: 'tallykonnect',
      emailBrand: 'tallykonnect',
      googleAccountKey: 'tallykonnect-google'
    });

    expect(row.automation_id).toBe('lead_generated');
    expect(updateGoogleSheetRowsBatch).toHaveBeenCalledWith(
      'sheet-1',
      'Leads',
      ['full_name', 'email', 'lead_status', 'Remarks', 'automation_id'],
      [{ rowNumber: 2, values: { automation_id: row.automation_id } }],
      { workspaceKey: 'tallykonnect', googleAccountKey: 'tallykonnect-google' }
    );
  });

  it('fails closed when Google Sheet automation_id write fails', async () => {
    vi.mocked(updateGoogleSheetRowsBatch).mockRejectedValue(new Error('No edit access'));

    await expect(
      ensureWorkflowAutomationIds([baseRow], {
        sourceType: 'google-sheet',
        spreadsheetId: 'sheet-1',
        sheetName: 'Leads',
        headers: ['automation_id'],
        workspaceKey: 'anywheretally',
        emailBrand: 'anywheretally',
        googleAccountKey: 'anywheretally-google'
      })
    ).rejects.toThrow('Could not save permanent automation_id to Google Sheet');
  });
});
