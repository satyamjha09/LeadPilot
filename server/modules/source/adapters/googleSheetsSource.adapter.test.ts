import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsSourceAdapter } from './googleSheetsSource.adapter';

function createMockSheetsClient() {
  const valuesGet = vi.fn(async ({ range }: { range: string }) => ({
    data: {
      values: [range.includes('Second Tab') ? ['email', 'lead_status'] : [' full_name ', '\u200Bemail']]
    }
  }));
  const valuesUpdate = vi.fn();

  return {
    spreadsheets: {
      get: vi.fn(async () => ({
        data: {
          properties: { title: 'AWT Main Leads' },
          sheets: [
            { properties: { sheetId: 0, title: 'Leads', index: 0 } },
            { properties: { sheetId: 12345, title: 'Second Tab', index: 1 } }
          ]
        }
      })),
      values: {
        get: valuesGet,
        update: valuesUpdate,
        batchUpdate: vi.fn()
      }
    }
  };
}

describe('GoogleSheetsSourceAdapter', () => {
  it('rejects invalid Google Sheets URLs', async () => {
    const adapter = new GoogleSheetsSourceAdapter({
      sheetsFactory: vi.fn()
    });

    await expect(
      adapter.inspect({ sheetUrl: 'https://example.com/not-a-sheet' }, { workspaceId: 'w1', workspaceKey: 'tallykonnect' })
    ).rejects.toThrow('Invalid Google Sheets URL');
  });

  it('discovers tabs, reads row 1 only, and uses the selected Google account client', async () => {
    const mockSheets = createMockSheetsClient();
    const sheetsFactory = vi.fn(async () => mockSheets as any);
    const adapter = new GoogleSheetsSourceAdapter({ sheetsFactory });

    const inspected = await adapter.inspect(
      {
        sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet123/edit#gid=12345',
        googleAccountKey: 'tallykonnect-google'
      },
      { workspaceId: 'w1', workspaceKey: 'anywheretally' }
    );

    expect(sheetsFactory).toHaveBeenCalledWith('tallykonnect-google');
    expect(inspected).toMatchObject({
      type: 'GOOGLE_SHEETS',
      externalFileId: 'sheet123',
      displayName: 'AWT Main Leads',
      preferredTabId: '12345'
    });
    expect(inspected.tabs).toHaveLength(2);
    expect(inspected.tabs[0]).toMatchObject({
      externalTabId: '0',
      name: 'Leads',
      position: 0,
      headers: ['full_name', 'email']
    });
    expect(mockSheets.spreadsheets.values.get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet123',
      range: "'Leads'!1:1"
    });
    expect(mockSheets.spreadsheets.values.get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet123',
      range: "'Second Tab'!1:1"
    });
    expect(mockSheets.spreadsheets.values.update).not.toHaveBeenCalled();
    expect(mockSheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });
});
