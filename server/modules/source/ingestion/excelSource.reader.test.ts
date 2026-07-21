import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryStorage } from '../../../infrastructure/storage/inMemoryStorage';
import { ExcelSourceReader } from './excelSource.reader';

function buildWorkbook() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['email'], ['a@example.com']]), 'First');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['email'], [''], ['b@example.com']]), 'Second');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

describe('ExcelSourceReader', () => {
  it('downloads once, maps worksheet IDs by position, and skips blank rows', async () => {
    const storage = new InMemoryStorage();
    await storage.putObject({ key: 'source.xlsx', body: buildWorkbook(), contentType: 'xlsx' });
    const getSpy = vi.spyOn(storage, 'getObject');
    const reader = new ExcelSourceReader(storage);

    const results = await reader.readEnabledTabs({
      workspaceKey: 'tallykonnect',
      source: { storageKey: 'source.xlsx' } as any,
      tabs: [
        { id: 'tab-1', externalTabId: 'worksheet-0', name: 'First', isEnabled: true } as any,
        { id: 'tab-2', externalTabId: 'worksheet-1', name: 'Second', isEnabled: true } as any
      ]
    });

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(results.map((tab) => tab.name)).toEqual(['First', 'Second']);
    expect(results[1].rows.map((row) => row.rowNumber)).toEqual([3]);
  });
});
