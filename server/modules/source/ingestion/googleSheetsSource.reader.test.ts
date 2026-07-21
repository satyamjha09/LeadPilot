import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsSourceReader } from './googleSheetsSource.reader';

describe('GoogleSheetsSourceReader', () => {
  it('reads enabled tabs only, skips blank rows, preserves row numbers, and performs no writes', async () => {
    const valuesUpdate = vi.fn();
    const valuesAppend = vi.fn();
    const valuesBatchUpdate = vi.fn();
    const sheets = {
      spreadsheets: {
        get: vi.fn(async () => ({
          data: { sheets: [{ properties: { sheetId: 0, title: 'Leads' } }] }
        })),
        values: {
          get: vi.fn(async () => ({
            data: { values: [['email'], ['a@example.com'], [''], ['b@example.com']] }
          })),
          update: valuesUpdate,
          append: valuesAppend,
          batchUpdate: valuesBatchUpdate
        }
      }
    };
    const reader = new GoogleSheetsSourceReader({ sheetsFactory: vi.fn(async () => sheets as any) });

    const results = await reader.readEnabledTabs({
      workspaceKey: 'anywheretally',
      source: { externalFileId: 'sheet-1' } as any,
      tabs: [
        { id: 'tab-1', externalTabId: '0', name: 'Leads', isEnabled: true } as any,
        { id: 'tab-2', externalTabId: '1', name: 'Disabled', isEnabled: false } as any
      ]
    });

    expect(results).toHaveLength(1);
    expect(results[0].rows.map((row) => row.rowNumber)).toEqual([2, 4]);
    expect(sheets.spreadsheets.values.get).toHaveBeenCalledWith({ spreadsheetId: 'sheet-1', range: "'Leads'!A:ZZ" });
    expect(valuesUpdate).not.toHaveBeenCalled();
    expect(valuesAppend).not.toHaveBeenCalled();
    expect(valuesBatchUpdate).not.toHaveBeenCalled();
  });
});
