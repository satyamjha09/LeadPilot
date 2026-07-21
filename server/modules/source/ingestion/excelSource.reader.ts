import * as XLSX from 'xlsx';
import type { DataSource, DataSourceTab } from '@prisma/client';

import type { ObjectStorage } from '../../../infrastructure/storage/objectStorage';
import { createHeaderHash, normalizeSourceHeaders } from '../sourceHeaders';
import type { SourceReader } from './sourceReader';
import type { ReadSourceTabResult } from './sourceIngestion.types';

function isBlankRow(values: unknown[]) {
  return values.every((value) => String(value ?? '').trim() === '');
}

export class ExcelSourceReader implements SourceReader {
  constructor(private storage: ObjectStorage) {}

  async readEnabledTabs(input: {
    source: DataSource;
    tabs: DataSourceTab[];
    workspaceKey: string;
  }): Promise<ReadSourceTabResult[]> {
    if (!input.source.storageKey) {
      throw new Error('Excel source is missing permanent object storage key.');
    }

    const buffer = await this.storage.getObject(input.source.storageKey);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const enabledTabs = input.tabs.filter((tab) => tab.isEnabled);

    return enabledTabs.map((tab) => {
      const indexMatch = tab.externalTabId.match(/^worksheet-(\d+)$/);
      const worksheetIndex = indexMatch ? Number(indexMatch[1]) : -1;
      const worksheetName = workbook.SheetNames[worksheetIndex];

      if (!worksheetName) {
        return {
          sourceTabId: tab.id,
          externalTabId: tab.externalTabId,
          name: tab.name,
          headers: Array.isArray(tab.headersJson) ? (tab.headersJson as string[]) : [],
          headerHash: tab.headerHash || '',
          rows: [],
          error: 'Worksheet was not found during source ingestion.'
        };
      }

      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[worksheetName], {
        header: 1,
        blankrows: false,
        raw: false
      });
      const headers = normalizeSourceHeaders(rows[0] || []);
      const dataRows = rows
        .slice(1)
        .map((values, index) => ({ rowNumber: index + 2, values: values || [] }))
        .filter((row) => !isBlankRow(row.values));

      return {
        sourceTabId: tab.id,
        externalTabId: tab.externalTabId,
        name: worksheetName,
        headers,
        headerHash: createHeaderHash(headers),
        rows: dataRows
      };
    });
  }
}
