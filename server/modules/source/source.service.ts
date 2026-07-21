import { getObjectStorage } from '../../infrastructure/storage/storageFactory';
import type { ObjectStorage } from '../../infrastructure/storage/objectStorage';
import { parseEmailBrand } from '../../../src/lib/emailBrand';
import { getWorkspaceOrThrow } from '../workspace/workspace.service';
import { ExcelSourceAdapter, createExcelChecksum, type RegisterExcelInput } from './adapters/excelSource.adapter';
import {
  GoogleSheetsSourceAdapter,
  type RegisterGoogleSheetsInput
} from './adapters/googleSheetsSource.adapter';
import type { InspectedSource, InspectedSourceTab } from './adapters/sourceAdapter';
import {
  archiveSource,
  createSourceWithTabs,
  findDataSourceByExternalFile,
  findExcelSourceByChecksum,
  findSourceWithTabs,
  listSourcesWithTabs,
  refreshSourceWithTabs,
  updateSourceDetails,
  updateSourceTab
} from './source.repository';
import type { SourceTabUpsertInput } from './source.types';
import { SourceNotFoundError, SourceValidationError, safeErrorMessage } from './sourceErrors';

type ServiceOptions = {
  googleAdapter?: GoogleSheetsSourceAdapter;
  excelAdapter?: ExcelSourceAdapter;
  storage?: ObjectStorage;
};

export type SourceServiceResult = {
  created: boolean;
  source: Awaited<ReturnType<typeof findSourceWithTabs>>;
};

function tabsToDbInput(tabs: InspectedSourceTab[]): SourceTabUpsertInput[] {
  return tabs.map((tab) => ({
    externalTabId: tab.externalTabId,
    name: tab.name,
    position: tab.position,
    headersJson: tab.headers,
    headerHash: tab.headerHash
  }));
}

function inspectedSourceDetails(inspected: InspectedSource) {
  return {
    type: inspected.type,
    displayName: inspected.displayName,
    externalFileId: inspected.externalFileId,
    originalFileName: inspected.originalFileName ?? null,
    storageKey: inspected.storageKey ?? null,
    mimeType: inspected.mimeType ?? null,
    checksum: inspected.checksum ?? null,
    fileSize: inspected.fileSize ?? null,
    connectionStatus: 'CONNECTED' as const,
    syncEnabled: true,
    archivedAt: null,
    lastValidatedAt: new Date(),
    lastError: null
  };
}

async function getWorkspace(workspaceKey: string) {
  const brand = parseEmailBrand(workspaceKey);
  const workspace = await getWorkspaceOrThrow(brand);
  return { brand, workspace };
}

export async function registerGoogleSheetsSource(
  workspaceKey: string,
  input: RegisterGoogleSheetsInput,
  options: ServiceOptions = {}
): Promise<SourceServiceResult> {
  const { brand, workspace } = await getWorkspace(workspaceKey);
  const googleAdapter = options.googleAdapter || new GoogleSheetsSourceAdapter();
  const inspected = await googleAdapter.inspect(input, {
    workspaceId: workspace.id,
    workspaceKey: brand
  });
  const tabs = tabsToDbInput(inspected.tabs);
  const existing = await findDataSourceByExternalFile({
    workspaceId: workspace.id,
    type: 'GOOGLE_SHEETS',
    externalFileId: inspected.externalFileId
  });

  if (existing) {
    const source = await refreshSourceWithTabs({
      workspaceId: workspace.id,
      sourceId: existing.id,
      source: inspectedSourceDetails(inspected),
      tabs
    });
    return { created: false, source };
  }

  const source = await createSourceWithTabs({
    workspaceId: workspace.id,
    ...inspectedSourceDetails(inspected),
    tabs,
    preferredTabId: inspected.preferredTabId
  });

  return { created: true, source };
}

export async function registerExcelSource(
  workspaceKey: string,
  input: RegisterExcelInput,
  options: ServiceOptions = {}
): Promise<SourceServiceResult> {
  const { brand, workspace } = await getWorkspace(workspaceKey);
  const checksum = createExcelChecksum(input.buffer);
  const existing = await findExcelSourceByChecksum(workspace.id, checksum);

  if (existing) {
    if (existing.archivedAt || existing.connectionStatus === 'ARCHIVED') {
      const restored = await updateSourceDetails({
        workspaceId: workspace.id,
        sourceId: existing.id,
        data: {
          archivedAt: null,
          connectionStatus: 'CONNECTED',
          syncEnabled: true,
          lastValidatedAt: new Date(),
          lastError: null
        }
      });
      return { created: false, source: restored };
    }

    return { created: false, source: existing };
  }

  const storage = options.storage || getObjectStorage();
  const excelAdapter = options.excelAdapter || new ExcelSourceAdapter(storage);
  const inspected = await excelAdapter.inspect(input, {
    workspaceId: workspace.id,
    workspaceKey: brand
  });
  const tabs = tabsToDbInput(inspected.tabs);

  try {
    const source = await createSourceWithTabs({
      workspaceId: workspace.id,
      ...inspectedSourceDetails(inspected),
      tabs,
      preferredTabId: inspected.preferredTabId
    });
    return { created: true, source };
  } catch (error) {
    if (inspected.storageKey) {
      await storage.deleteObject(inspected.storageKey);
    }
    throw error;
  }
}

export async function listWorkspaceSources(workspaceKey: string) {
  const { workspace } = await getWorkspace(workspaceKey);
  return listSourcesWithTabs(workspace.id);
}

export async function getWorkspaceSource(workspaceKey: string, sourceId: string) {
  const { workspace } = await getWorkspace(workspaceKey);
  const source = await findSourceWithTabs(workspace.id, sourceId);
  if (!source || source.archivedAt) {
    throw new SourceNotFoundError('Source not found.');
  }
  return source;
}

export async function validateWorkspaceSource(workspaceKey: string, sourceId: string, options: ServiceOptions = {}) {
  const { brand, workspace } = await getWorkspace(workspaceKey);
  const source = await getWorkspaceSource(workspaceKey, sourceId);
  let inspected: InspectedSource;

  try {
    if (source.type === 'GOOGLE_SHEETS') {
      const googleAdapter = options.googleAdapter || new GoogleSheetsSourceAdapter();
      inspected = await googleAdapter.inspect(
        { sheetUrl: `https://docs.google.com/spreadsheets/d/${source.externalFileId}/edit`, displayName: source.displayName },
        { workspaceId: workspace.id, workspaceKey: brand }
      );
    } else if (source.type === 'EXCEL') {
      if (!source.storageKey || !source.originalFileName || !source.mimeType) {
        throw new SourceValidationError('Excel source does not have enough stored file metadata to validate.');
      }
      const storage = options.storage || getObjectStorage();
      const buffer = await storage.getObject(source.storageKey);
      const excelAdapter = options.excelAdapter || new ExcelSourceAdapter(storage);
      inspected = await excelAdapter.inspect(
        {
          buffer,
          originalFileName: source.originalFileName,
          mimeType: source.mimeType,
          displayName: source.displayName,
          externalFileId: source.externalFileId || source.id,
          storageKey: source.storageKey,
          skipUpload: true
        },
        { workspaceId: workspace.id, workspaceKey: brand }
      );
    } else {
      throw new SourceValidationError(`Unsupported source type: ${source.type}`);
    }
  } catch (error) {
    await updateSourceDetails({
      workspaceId: workspace.id,
      sourceId,
      data: {
        connectionStatus: 'ERROR',
        lastValidatedAt: new Date(),
        lastError: safeErrorMessage(error)
      }
    });
    throw error;
  }

  return refreshSourceWithTabs({
    workspaceId: workspace.id,
    sourceId,
    source: inspectedSourceDetails(inspected),
    tabs: tabsToDbInput(inspected.tabs)
  });
}

export async function renameWorkspaceSource(workspaceKey: string, sourceId: string, displayName: string) {
  const { workspace } = await getWorkspace(workspaceKey);
  const normalizedDisplayName = displayName.trim();
  if (!normalizedDisplayName) {
    throw new SourceValidationError('displayName cannot be empty.');
  }
  return updateSourceDetails({
    workspaceId: workspace.id,
    sourceId,
    data: { displayName: normalizedDisplayName }
  });
}

export async function setSourceSyncEnabled(workspaceKey: string, sourceId: string, syncEnabled: boolean) {
  const { workspace } = await getWorkspace(workspaceKey);
  return updateSourceDetails({
    workspaceId: workspace.id,
    sourceId,
    data: { syncEnabled }
  });
}

export async function setSourceTabEnabled(
  workspaceKey: string,
  sourceId: string,
  tabId: string,
  isEnabled: boolean
) {
  const { workspace } = await getWorkspace(workspaceKey);
  const source = await updateSourceTab({
    workspaceId: workspace.id,
    sourceId,
    tabId,
    isEnabled
  });
  if (!source) {
    throw new SourceNotFoundError('Source tab not found.');
  }
  return source;
}

export async function archiveWorkspaceSource(workspaceKey: string, sourceId: string) {
  const { workspace } = await getWorkspace(workspaceKey);
  const source = await archiveSource(workspace.id, sourceId);
  if (!source) {
    throw new SourceNotFoundError('Source not found.');
  }
  return source;
}
