import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { InMemoryStorage } from '../../../infrastructure/storage/inMemoryStorage';
import { ExcelSourceAdapter, createExcelChecksum } from './excelSource.adapter';

function workbookBuffer(bookType: XLSX.BookType = 'xlsx') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [' full_name ', '\u200Bemail'],
      ['A', 'a@example.com']
    ]),
    'Leads'
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['lead_status']]), 'Archive');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType }));
}

describe('ExcelSourceAdapter', () => {
  it('inspects xlsx workbooks, extracts worksheets, calculates checksum, and uploads the object', async () => {
    const storage = new InMemoryStorage();
    const adapter = new ExcelSourceAdapter(storage);
    const buffer = workbookBuffer('xlsx');

    const inspected = await adapter.inspect(
      {
        buffer,
        originalFileName: 'july leads.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      },
      { workspaceId: 'w1', workspaceKey: 'anywheretally' }
    );

    expect(inspected.type).toBe('EXCEL');
    expect(inspected.checksum).toBe(createExcelChecksum(buffer));
    expect(inspected.tabs).toMatchObject([
      { externalTabId: 'worksheet-0', name: 'Leads', headers: ['full_name', 'email'] },
      { externalTabId: 'worksheet-1', name: 'Archive', headers: ['lead_status'] }
    ]);
    expect(inspected.storageKey).toContain('workspaces/anywheretally/sources/');
    await expect(storage.objectExists(inspected.storageKey || '')).resolves.toBe(true);
  });

  it('inspects xls workbooks', async () => {
    const adapter = new ExcelSourceAdapter(new InMemoryStorage());
    await expect(
      adapter.inspect(
        {
          buffer: workbookBuffer('xls'),
          originalFileName: 'legacy.xls',
          mimeType: 'application/vnd.ms-excel'
        },
        { workspaceId: 'w1', workspaceKey: 'tallykonnect' }
      )
    ).resolves.toMatchObject({ type: 'EXCEL' });
  });

  it('rejects oversized and invalid workbook inputs', async () => {
    const adapter = new ExcelSourceAdapter(new InMemoryStorage());
    await expect(
      adapter.inspect(
        {
          buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
          originalFileName: 'big.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        },
        { workspaceId: 'w1', workspaceKey: 'tallykonnect' }
      )
    ).rejects.toThrow('10 MB');

    await expect(
      adapter.inspect(
        {
          buffer: Buffer.from('not excel'),
          originalFileName: 'bad.txt',
          mimeType: 'text/plain'
        },
        { workspaceId: 'w1', workspaceKey: 'tallykonnect' }
      )
    ).rejects.toThrow('Only .xlsx and .xls');
  });
});
