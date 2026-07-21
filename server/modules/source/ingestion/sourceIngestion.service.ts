import type { DataSourceType, SourceRowValidationStatus } from '@prisma/client';

import { getObjectStorage } from '../../../infrastructure/storage/storageFactory';
import { parseEmailBrand } from '../../../../src/lib/emailBrand';
import { getWorkspaceOrThrow } from '../../workspace/workspace.service';
import { SourceConfigurationError, SourceValidationError, safeErrorMessage } from '../sourceErrors';
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
