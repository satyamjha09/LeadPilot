import { google } from 'googleapis';
import type { DataSource, DataSourceTab } from '@prisma/client';

import { getOAuthClient } from '../../../googleAuth';
import { parseEmailBrand } from '../../../../src/lib/emailBrand';
import { defaultSenderAccountForBrand } from '../../../../src/lib/senderAccount';
import { createHeaderHash, normalizeSourceHeaders } from '../sourceHeaders';
import type { SourceReader } from './sourceReader';
import type { ReadSourceTabResult } from './sourceIngestion.types';

type SheetsClient = ReturnType<typeof google.sheets>;

export type GoogleSheetsSourceReaderOptions = {
  sheetsFactory?: (brand: ReturnType<typeof parseEmailBrand>) => Promise<SheetsClient>;
};

function quoteSheetName(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

async function defaultSheetsFactory(brand: ReturnType<typeof parseEmailBrand>) {
  const oauth2Client = await getOAuthClient(defaultSenderAccountForBrand(brand));
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

function isBlankRow(values: unknown[]) {
  return values.every((value) => String(value ?? '').trim() === '');
}

export class GoogleSheetsSourceReader implements SourceReader {
  private sheetsFactory: NonNullable<GoogleSheetsSourceReaderOptions['sheetsFactory']>;

  constructor(options: GoogleSheetsSourceReaderOptions = {}) {
    this.sheetsFactory = options.sheetsFactory || defaultSheetsFactory;
  }

  async readEnabledTabs(input: {
    source: DataSource;
    tabs: DataSourceTab[];
    workspaceKey: string;
  }): Promise<ReadSourceTabResult[]> {
    if (!input.source.externalFileId) {
      throw new Error('Google Sheets source is missing spreadsheet ID.');
    }

    const brand = parseEmailBrand(input.workspaceKey);
    const sheets = await this.sheetsFactory(brand);
    const metadata = await sheets.spreadsheets.get({ spreadsheetId: input.source.externalFileId });
    const currentTabs = new Map(
      (metadata.data.sheets || []).map((sheet) => [String(sheet.properties?.sheetId), sheet.properties?.title || ''])
    );

    const enabledTabs = input.tabs.filter((tab) => tab.isEnabled);
    const results: ReadSourceTabResult[] = [];

    for (const tab of enabledTabs) {
      const currentName = currentTabs.get(tab.externalTabId);
      if (!currentName) {
        results.push({
          sourceTabId: tab.id,
          externalTabId: tab.externalTabId,
          name: tab.name,
          headers: Array.isArray(tab.headersJson) ? (tab.headersJson as string[]) : [],
          headerHash: tab.headerHash || '',
          rows: [],
          error: 'Tab was not found during source ingestion.'
        });
        continue;
      }

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: input.source.externalFileId,
        range: `${quoteSheetName(currentName)}!A:ZZ`
      });
      const values = response.data.values || [];
      const headers = normalizeSourceHeaders(values[0] || []);
      const rows = values
        .slice(1)
        .map((row, index) => ({ rowNumber: index + 2, values: row || [] }))
        .filter((row) => !isBlankRow(row.values));

      results.push({
        sourceTabId: tab.id,
        externalTabId: tab.externalTabId,
        name: currentName,
        headers,
        headerHash: createHeaderHash(headers),
        rows
      });
    }

    return results;
  }
}
