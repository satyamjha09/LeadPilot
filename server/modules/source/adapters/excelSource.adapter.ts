import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import * as XLSX from 'xlsx';

import type { ObjectStorage } from '../../../infrastructure/storage/objectStorage';
import { buildSourceObjectKey } from '../../../infrastructure/storage/objectStorage';
import { createHeaderHash, normalizeSourceHeaders } from '../sourceHeaders';
import type { InspectedSource, SourceAdapter, SourceAdapterContext } from './sourceAdapter';

const MAX_EXCEL_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = new Set(['.xlsx', '.xls']);
const ACCEPTED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream'
]);

export type RegisterExcelInput = {
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
  displayName?: string;
  externalFileId?: string;
  storageKey?: string;
  skipUpload?: boolean;
};

export function createExcelChecksum(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function assertValidExcelInput(input: RegisterExcelInput) {
  if (input.buffer.length > MAX_EXCEL_FILE_SIZE_BYTES) {
    throw new Error('Excel file must be 10 MB or smaller.');
  }

  const extension = path.extname(input.originalFileName || '').toLowerCase();
  if (!ACCEPTED_EXTENSIONS.has(extension)) {
    throw new Error('Only .xlsx and .xls files are supported.');
  }

  if (input.mimeType && !ACCEPTED_MIME_TYPES.has(input.mimeType)) {
    throw new Error('Unsupported Excel file type.');
  }
}

export class ExcelSourceAdapter implements SourceAdapter<RegisterExcelInput> {
  constructor(private storage: ObjectStorage) {}

  async inspect(input: RegisterExcelInput, context: SourceAdapterContext): Promise<InspectedSource> {
    assertValidExcelInput(input);

    const checksum = createExcelChecksum(input.buffer);
    let workbook: XLSX.WorkBook;

    try {
      workbook = XLSX.read(input.buffer, { type: 'buffer' });
    } catch {
      throw new Error('Invalid Excel workbook.');
    }

    if (!workbook.SheetNames.length) {
      throw new Error('Excel workbook has no worksheets.');
    }

    const externalFileId = input.externalFileId || randomUUID();
    const storageKey =
      input.storageKey ||
      buildSourceObjectKey({
        workspaceKey: context.workspaceKey,
        externalFileId,
        originalFileName: input.originalFileName
      });

    const tabs = workbook.SheetNames.map((sheetName, index) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        blankrows: false,
        raw: false
      });
      const headers = normalizeSourceHeaders(rows[0] || []);

      return {
        externalTabId: `worksheet-${index}`,
        name: sheetName,
        position: index,
        headers,
        headerHash: createHeaderHash(headers)
      };
    });

    if (!input.skipUpload) {
      await this.storage.putObject({
        key: storageKey,
        body: input.buffer,
        contentType: input.mimeType || 'application/octet-stream'
      });
    }

    return {
      type: 'EXCEL',
      externalFileId,
      displayName: input.displayName?.trim() || input.originalFileName,
      originalFileName: input.originalFileName,
      storageKey,
      mimeType: input.mimeType,
      checksum,
      fileSize: input.buffer.length,
      preferredTabId: tabs[0]?.externalTabId,
      tabs
    };
  }
}
