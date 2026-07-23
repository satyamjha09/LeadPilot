import type { DataSourceType, SourceRowValidationStatus } from '@prisma/client';

import { getObjectStorage } from '../../../infrastructure/storage/storageFactory';
import { parseEmailBrand } from '../../../../src/lib/emailBrand';
import { defaultSenderAccountForBrand } from '../../../../src/lib/senderAccount';
import type { ExcelRow } from '../../../../src/types';
import { runLeadMatching } from '../../lead/matching/leadMatch.service';
import { getWorkspaceOrThrow } from '../../workspace/workspace.service';
import { SourceConfigurationError, SourceConflictError, SourceNotFoundError, SourceValidationError, safeErrorMessage } from '../sourceErrors';
import { ExcelSourceReader } from './excelSource.reader';
import { GoogleSheetsSourceReader } from './googleSheetsSource.reader';
import { normalizeReadSourceTab } from './sourceRowNormalizer';
import type { SourceReader } from './sourceReader';
import {
  createProcessingSnapshot,
  failSnapshot,
  finalizeSnapshot,
  getCurrentSourceRow,
  getSourceForIngestion,
  getSourceSnapshot,
  getSourceSnapshotForTab,
  listAllActiveSourceRowsForTab,
  listCurrentSourceRows,
  listSourceSnapshots,
  stageSnapshotRows
} from './sourceIngestion.repository';
import type { NormalizedReadRow, ReadSourceTabResult } from './sourceIngestion.types';

type IngestionOptions = {
  reader?: SourceReader;
};

function readerForType(type: DataSourceType) {
  if (type === 'GOOGLE_SHEETS') return new GoogleSheetsSourceReader();
  if (type === 'EXCEL') return new ExcelSourceReader(getObjectStorage());
  throw new SourceValidationError(`Unsupported source type: ${type}`);
}

function parseLimit(value: unknown) {
  const parsed = Number(value || 50);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(Math.floor(parsed), 200);
}

async function getWorkspaceAndSource(workspaceKey: string, sourceId: string) {
  const brand = parseEmailBrand(workspaceKey);
  const workspace = await getWorkspaceOrThrow(brand);
  const source = await getSourceForIngestion(workspace.id, sourceId);
  return { brand, workspace, source };
}

export async function ingestWorkspaceSource(workspaceKey: string, sourceId: string, options: IngestionOptions = {}) {
  const { brand, source } = await getWorkspaceAndSource(workspaceKey, sourceId);

  if (source.archivedAt || source.connectionStatus === 'ARCHIVED') {
    throw new SourceValidationError('Archived sources cannot be ingested.');
  }
  if (source.connectionStatus === 'DISCONNECTED') {
    throw new SourceValidationError('Disconnected sources cannot be ingested.');
  }

  const enabledTabs = source.tabs.filter((tab) => tab.isEnabled);
  if (enabledTabs.length === 0) {
    throw new SourceValidationError('At least one source tab must be enabled before ingestion.');
  }

  if (source.type === 'EXCEL' && !source.storageKey) {
    throw new SourceConfigurationError('Excel source is missing permanent R2 storage metadata.');
  }

  const snapshot = await createProcessingSnapshot(source.id, 'MANUAL');

  try {
    const reader = options.reader || readerForType(source.type);
    const readTabs = await reader.readEnabledTabs({
      source,
      tabs: enabledTabs,
      workspaceKey: brand
    });
    const successfulTabs: Array<{
      sourceTabId: string;
      headerHash: string;
      headers: string[];
      rows: NormalizedReadRow[];
    }> = [];
    const failedTabs: Array<{ sourceTabId: string; headerHash?: string | null; error: string }> = [];
    const allRows: NormalizedReadRow[] = [];

    for (const tab of readTabs) {
      if (tab.error) {
        failedTabs.push({
          sourceTabId: tab.sourceTabId,
          headerHash: tab.headerHash,
          error: tab.error
        });
        continue;
      }

      const normalizedRows = normalizeReadSourceTab(tab);
      allRows.push(...normalizedRows);
      successfulTabs.push({
        sourceTabId: tab.sourceTabId,
        headerHash: tab.headerHash,
        headers: tab.headers,
        rows: normalizedRows
      });
    }

    const readSourceTabIds = new Set(readTabs.map((tab) => tab.sourceTabId));
    for (const enabledTab of enabledTabs) {
      if (!readSourceTabIds.has(enabledTab.id)) {
        failedTabs.push({
          sourceTabId: enabledTab.id,
          headerHash: enabledTab.headerHash,
          error: 'Enabled tab was not returned by the source reader.'
        });
      }
    }

    await stageSnapshotRows(snapshot.id, allRows);
    return finalizeSnapshot({
      snapshotId: snapshot.id,
      sourceId: source.id,
      sourceTabs: enabledTabs,
      successfulTabs,
      failedTabs
    });
  } catch (error) {
    await failSnapshot(snapshot.id, source.id, safeErrorMessage(error));
    throw error;
  }
}

export const ingestAllEnabledSourceTabs = ingestWorkspaceSource;

function assertSourceReadyForIngestion(source: Awaited<ReturnType<typeof getSourceForIngestion>>) {
  if (source.archivedAt || source.connectionStatus === 'ARCHIVED') {
    throw new SourceValidationError('Archived sources cannot be ingested.');
  }
  if (source.connectionStatus === 'DISCONNECTED') {
    throw new SourceValidationError('Disconnected sources cannot be ingested.');
  }
  if (source.type === 'EXCEL' && !source.storageKey) {
    throw new SourceConfigurationError('Excel source is missing permanent R2 storage metadata.');
  }
}

export async function ingestWorkspaceSourceTab(
  workspaceKey: string,
  sourceId: string,
  sourceTabId: string,
  options: IngestionOptions = {}
) {
  if (!sourceTabId) {
    throw new SourceValidationError('sourceTabId is required.', 'SOURCE_TAB_REQUIRED');
  }
  const { brand, source } = await getWorkspaceAndSource(workspaceKey, sourceId);
  assertSourceReadyForIngestion(source);
  const selectedTab = source.tabs.find((tab) => tab.id === sourceTabId);
  if (!selectedTab) {
    throw new SourceNotFoundError('Source tab not found.', 'SOURCE_TAB_NOT_FOUND');
  }
  if (!selectedTab.isEnabled) {
    throw new SourceConflictError('Disabled source tabs cannot be processed.', 'SOURCE_TAB_DISABLED');
  }

  const snapshot = await createProcessingSnapshot(source.id, 'SELECTED_TAB', selectedTab.id);

  try {
    const reader = options.reader || readerForType(source.type);
    const readTabs = await reader.readEnabledTabs({
      source,
      tabs: [selectedTab],
      workspaceKey: brand
    });
    const readTab = readTabs.find((tab) => tab.sourceTabId === selectedTab.id);

    if (!readTab) {
      await finalizeSnapshot({
        snapshotId: snapshot.id,
        sourceId: source.id,
        sourceTabs: [selectedTab],
        successfulTabs: [],
        failedTabs: [
          {
            sourceTabId: selectedTab.id,
            headerHash: selectedTab.headerHash,
            error: 'Selected tab was not returned by the source reader.'
          }
        ]
      });
      throw new SourceConflictError('Selected tab was not returned by the source reader.', 'SOURCE_TAB_READ_FAILED');
    }

    if (readTab.error) {
      await finalizeSnapshot({
        snapshotId: snapshot.id,
        sourceId: source.id,
        sourceTabs: [selectedTab],
        successfulTabs: [],
        failedTabs: [
          {
            sourceTabId: selectedTab.id,
            headerHash: readTab.headerHash,
            error: readTab.error
          }
        ]
      });
      throw new SourceConflictError(readTab.error, 'SOURCE_TAB_READ_FAILED');
    }

    const normalizedRows = normalizeReadSourceTab(readTab);
    await stageSnapshotRows(snapshot.id, normalizedRows);
    return finalizeSnapshot({
      snapshotId: snapshot.id,
      sourceId: source.id,
      sourceTabs: [selectedTab],
      successfulTabs: [
        {
          sourceTabId: selectedTab.id,
          headerHash: readTab.headerHash,
          headers: readTab.headers,
          rows: normalizedRows
        }
      ],
      failedTabs: []
    });
  } catch (error) {
    const latest = await getSourceSnapshot(source.id, snapshot.id).catch(() => null);
    if (latest?.status === 'PROCESSING') {
      await failSnapshot(snapshot.id, source.id, safeErrorMessage(error));
    }
    throw error;
  }
}

function rawColumns(row: { rawData: unknown }) {
  const raw = row.rawData as { headers?: unknown[]; values?: unknown[] } | null;
  const headers = Array.isArray(raw?.headers) ? raw.headers.map((header) => String(header || '')) : [];
  const values = Array.isArray(raw?.values) ? raw.values : [];
  return { headers, values };
}

function sourceRowToWorkflowRow(input: {
  row: Awaited<ReturnType<typeof listAllActiveSourceRowsForTab>>[number];
  workspaceKey: ReturnType<typeof parseEmailBrand>;
  source: Awaited<ReturnType<typeof getSourceForIngestion>>;
  tab: Awaited<ReturnType<typeof getSourceForIngestion>>['tabs'][number];
  sourceSnapshotId: string;
}): ExcelRow {
  const { headers, values } = rawColumns(input.row);
  const originalColumns = headers.length > 0 ? headers : Array.isArray(input.tab.headersJson) ? input.tab.headersJson.map(String) : [];
  const originalData = Object.fromEntries(originalColumns.map((header, index) => [header, values[index] ?? '']));
  const sourceType = input.source.type === 'GOOGLE_SHEETS' ? 'google-sheet' : 'excel';

  return {
    ...originalData,
    id: input.row.id,
    __sourceType: sourceType,
    __workspaceKey: input.workspaceKey,
    __sourceId: input.source.id,
    __sourceTabId: input.tab.id,
    __sourceRowId: input.row.id,
    __sourceSnapshotId: input.sourceSnapshotId,
    __sourceRowNumber: input.row.rowNumber || undefined,
    __sheetRowNumber: sourceType === 'google-sheet' ? input.row.rowNumber || undefined : undefined,
    __spreadsheetId: sourceType === 'google-sheet' ? input.source.externalFileId || undefined : undefined,
    __sheetName: sourceType === 'google-sheet' ? input.tab.name : undefined,
    __externalTabId: input.tab.externalTabId,
    __originalColumns: originalColumns,
    full_name: input.row.fullName || '',
    email: input.row.email || '',
    phone: input.row.phone || '',
    automation_id: input.row.automationId || '',
    'Date of Demo': input.row.demoDate || '',
    'Time of Demo': input.row.demoTime || '',
    'Meeting Details': input.row.meetingLink || '',
    lead_status: input.row.leadStatus || '',
    Remarks: input.row.remarks || ''
  };
}

export async function buildSelectedTabWorkflowRows(input: {
  workspaceKey: string;
  sourceId: string;
  sourceTabId: string;
  sourceSnapshotId: string;
  selectedSourceRowIds?: string[];
  emailBrandKey?: string;
}) {
  const { brand, source } = await getWorkspaceAndSource(input.workspaceKey, input.sourceId);
  const tab = source.tabs.find((item) => item.id === input.sourceTabId);
  if (!tab) throw new SourceNotFoundError('Source tab not found.', 'SOURCE_TAB_NOT_FOUND');
  const snapshot = await getSourceSnapshotForTab(source.id, tab.id, input.sourceSnapshotId);
  const sourceRows = await listAllActiveSourceRowsForTab({
    sourceId: source.id,
    sourceTabId: tab.id,
    sourceSnapshotId: snapshot.id,
    selectedSourceRowIds: input.selectedSourceRowIds
  });
  const workflowRows = sourceRows.map((row) =>
    sourceRowToWorkflowRow({
      row,
      workspaceKey: brand,
      source,
      tab,
      sourceSnapshotId: snapshot.id
    })
  );
  const emailBrand = input.emailBrandKey ? parseEmailBrand(input.emailBrandKey) : brand;
  return {
    workspaceKey: brand,
    source,
    tab,
    snapshot,
    rows: workflowRows.map((row) => ({ ...row, __emailBrand: emailBrand }))
  };
}

export async function prepareSelectedTabProcessing(workspaceKey: string, sourceId: string, sourceTabId: string) {
  const snapshot = await ingestWorkspaceSourceTab(workspaceKey, sourceId, sourceTabId);
  await runLeadMatching(workspaceKey, sourceId, snapshot.id).catch((error) => {
    console.warn('SELECTED_TAB_LEAD_MATCHING_FAILED', {
      sourceId,
      sourceTabId,
      snapshotId: snapshot.id,
      message: error instanceof Error ? error.message : String(error)
    });
  });
  const prepared = await buildSelectedTabWorkflowRows({
    workspaceKey,
    sourceId,
    sourceTabId,
    sourceSnapshotId: snapshot.id
  });
  const googleAccountKey =
    prepared.source.type === 'GOOGLE_SHEETS'
      ? prepared.source.googleAccountKey || defaultSenderAccountForBrand(prepared.workspaceKey)
      : undefined;

  return {
    workspaceKey: prepared.workspaceKey,
    googleAccountKey,
    source: {
      id: prepared.source.id,
      type: prepared.source.type === 'GOOGLE_SHEETS' ? 'google-sheet' : 'excel',
      displayName: prepared.source.displayName,
      connectionStatus: prepared.source.connectionStatus
    },
    tab: {
      id: prepared.tab.id,
      externalTabId: prepared.tab.externalTabId,
      name: prepared.tab.name,
      position: prepared.tab.position,
      headers: Array.isArray(prepared.tab.headersJson) ? prepared.tab.headersJson : [],
      rowCount: prepared.tab.rowCount,
      isEnabled: prepared.tab.isEnabled,
      lastSyncedAt: prepared.tab.lastSyncedAt,
      lastError: prepared.tab.lastError
    },
    snapshot: {
      id: prepared.snapshot.id,
      version: prepared.snapshot.version,
      status: prepared.snapshot.status,
      rowCount: prepared.snapshot.rowCount,
      addedCount: prepared.snapshot.addedCount,
      updatedCount: prepared.snapshot.updatedCount,
      unchangedCount: prepared.snapshot.unchangedCount,
      removedCount: prepared.snapshot.removedCount,
      invalidCount: prepared.snapshot.invalidCount
    },
    rows: prepared.rows,
    counts: {
      total: prepared.rows.length,
      valid: prepared.rows.filter((row) => !row.__schedulerStatus).length,
      invalid: prepared.snapshot.invalidCount
    }
  };
}

export async function listWorkspaceSourceSnapshots(workspaceKey: string, sourceId: string, cursor?: string, limit?: unknown) {
  const { source } = await getWorkspaceAndSource(workspaceKey, sourceId);
  const take = parseLimit(limit);
  const rows = await listSourceSnapshots(source.id, cursor, take);
  return {
    snapshots: rows.slice(0, take),
    nextCursor: rows.length > take ? rows[take].id : null
  };
}

export async function getWorkspaceSourceSnapshot(workspaceKey: string, sourceId: string, snapshotId: string) {
  const { source } = await getWorkspaceAndSource(workspaceKey, sourceId);
  return getSourceSnapshot(source.id, snapshotId);
}

export async function listWorkspaceCurrentSourceRows(
  workspaceKey: string,
  sourceId: string,
  query: {
    tabId?: string;
    active?: string;
    validationStatus?: SourceRowValidationStatus;
    search?: string;
    cursor?: string;
    limit?: unknown;
  }
) {
  const { source } = await getWorkspaceAndSource(workspaceKey, sourceId);
  const limit = parseLimit(query.limit);
  const active = query.active === undefined ? undefined : query.active === 'true';
  const rows = await listCurrentSourceRows({
    sourceId: source.id,
    tabId: query.tabId,
    active,
    validationStatus: query.validationStatus,
    search: query.search,
    cursor: query.cursor,
    limit
  });

  return {
    rows: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit].id : null,
    limit
  };
}

export async function getWorkspaceCurrentSourceRow(workspaceKey: string, sourceId: string, rowId: string) {
  const { source } = await getWorkspaceAndSource(workspaceKey, sourceId);
  return getCurrentSourceRow(source.id, rowId);
}
