import { google } from 'googleapis';

import { getVerifiedOAuthClient } from '../../../googleAuth';
import { extractSheetInfo } from '../../../googleSheets';
import { parseEmailBrand } from '../../../../src/lib/emailBrand';
import { defaultSenderAccountForBrand, parseSenderAccountKey, type SenderAccountKey } from '../../../../src/lib/senderAccount';
import { createHeaderHash, normalizeSourceHeaders } from '../sourceHeaders';
import type { InspectedSource, SourceAdapter, SourceAdapterContext } from './sourceAdapter';

export type RegisterGoogleSheetsInput = {
  sheetUrl: string;
  displayName?: string;
  googleAccountKey?: unknown;
};

type SheetsClient = ReturnType<typeof google.sheets>;

export type GoogleSheetsSourceAdapterOptions = {
  sheetsFactory?: (googleAccountKey: SenderAccountKey) => Promise<SheetsClient>;
};

function quoteSheetName(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

async function defaultSheetsFactory(googleAccountKey: SenderAccountKey) {
  const oauth2Client = await getVerifiedOAuthClient(googleAccountKey);
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

export class GoogleSheetsSourceAdapter implements SourceAdapter<RegisterGoogleSheetsInput> {
  private sheetsFactory: NonNullable<GoogleSheetsSourceAdapterOptions['sheetsFactory']>;

  constructor(options: GoogleSheetsSourceAdapterOptions = {}) {
    this.sheetsFactory = options.sheetsFactory || defaultSheetsFactory;
  }

  async inspect(input: RegisterGoogleSheetsInput, context: SourceAdapterContext): Promise<InspectedSource> {
    const { spreadsheetId, gid } = extractSheetInfo(input.sheetUrl);
    const brand = parseEmailBrand(context.workspaceKey);
    const googleAccountKey = input.googleAccountKey || context.googleAccountKey
      ? parseSenderAccountKey(input.googleAccountKey || context.googleAccountKey)
      : defaultSenderAccountForBrand(brand);
    const sheets = await this.sheetsFactory(googleAccountKey);
    const metadata = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetTabs = metadata.data.sheets || [];

    if (sheetTabs.length === 0) {
      throw new Error('Spreadsheet has no sheet tabs.');
    }

    const tabs = await Promise.all(
      sheetTabs.map(async (sheet, index) => {
        const properties = sheet.properties;
        const title = properties?.title;
        const sheetId = properties?.sheetId;

        if (!title || sheetId === null || sheetId === undefined) {
          throw new Error('Spreadsheet contains a tab without readable metadata.');
        }

        const rowOne = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${quoteSheetName(title)}!1:1`
        });
        const headers = normalizeSourceHeaders(rowOne.data.values?.[0] || []);

        return {
          externalTabId: String(sheetId),
          name: title,
          position: properties?.index ?? index,
          headers,
          headerHash: createHeaderHash(headers)
        };
      })
    );

    return {
      type: 'GOOGLE_SHEETS',
      externalFileId: spreadsheetId,
      displayName: input.displayName?.trim() || metadata.data.properties?.title || spreadsheetId,
      preferredTabId: gid,
      tabs
    };
  }
}
