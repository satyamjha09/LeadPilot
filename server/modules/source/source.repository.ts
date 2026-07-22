import { prisma } from '../../db';
import type {
  DataSourceCreateInput,
  DataSourceTabCreateInput,
  SourceRowCreateInput,
  SourceDetailsUpdateInput,
  SourceSnapshotCreateInput,
  SourceWithTabsInput
} from './source.types';
import { buildInitialTabRows, buildTabRefreshPlan } from './sourceTabRefresh';
import { SourceNotFoundError } from './sourceErrors';

export async function createDataSource(input: DataSourceCreateInput) {
  return prisma.dataSource.create({
    data: {
      workspaceId: input.workspaceId,
      type: input.type,
      displayName: input.displayName,
      externalFileId: input.externalFileId ?? null,
      originalFileName: input.originalFileName ?? null,
      storageKey: input.storageKey ?? null,
      mimeType: input.mimeType ?? null,
      checksum: input.checksum ?? null,
      fileSize: input.fileSize ?? null,
      googleAccountKey: input.googleAccountKey ?? null,
      connectionStatus: input.connectionStatus || 'CONNECTED',
      syncEnabled: input.syncEnabled ?? true
    }
  });
}

export async function findDataSourceByExternalFile(input: {
  workspaceId: string;
  type: DataSourceCreateInput['type'];
  externalFileId: string;
}) {
  return prisma.dataSource.findUnique({
    where: {
      workspaceId_type_externalFileId: input
    }
  });
}

export async function findWorkspaceSourceById(workspaceId: string, sourceId: string) {
  return prisma.dataSource.findFirst({
    where: { id: sourceId, workspaceId, archivedAt: null },
    include: { tabs: { orderBy: { position: 'asc' } } }
  });
}

export async function findExcelSourceByChecksum(workspaceId: string, checksum: string) {
  return prisma.dataSource.findUnique({
    where: {
      workspaceId_type_checksum: {
        workspaceId,
        type: 'EXCEL',
        checksum
      }
    },
    include: { tabs: { orderBy: { position: 'asc' } } }
  });
}

export async function findSourceWithTabs(workspaceId: string, sourceId: string) {
  return prisma.dataSource.findFirst({
    where: { id: sourceId, workspaceId },
    include: { tabs: { orderBy: { position: 'asc' } } }
  });
}

export async function listDataSourcesForWorkspace(workspaceId: string) {
  return prisma.dataSource.findMany({
    where: { workspaceId, archivedAt: null },
    orderBy: { updatedAt: 'desc' },
    include: { tabs: true }
  });
}

export async function listSourcesWithTabs(workspaceId: string) {
  return prisma.dataSource.findMany({
    where: { workspaceId, archivedAt: null },
    orderBy: { updatedAt: 'desc' },
    include: { tabs: { orderBy: { position: 'asc' } } }
  });
}

export async function createSourceWithTabs(input: SourceWithTabsInput) {
  return prisma.$transaction(async (tx) => {
    const source = await tx.dataSource.create({
      data: {
        workspaceId: input.workspaceId,
        type: input.type,
        displayName: input.displayName,
        externalFileId: input.externalFileId ?? null,
        originalFileName: input.originalFileName ?? null,
        storageKey: input.storageKey ?? null,
        mimeType: input.mimeType ?? null,
        checksum: input.checksum ?? null,
        fileSize: input.fileSize ?? null,
        googleAccountKey: input.googleAccountKey ?? null,
        connectionStatus: input.connectionStatus || 'CONNECTED',
        syncEnabled: input.syncEnabled ?? true
      }
    });

    await tx.dataSourceTab.createMany({
      data: buildInitialTabRows({
        dataSourceId: source.id,
        tabs: input.tabs,
        preferredTabId: input.preferredTabId
      })
    });

    return tx.dataSource.findUniqueOrThrow({
      where: { id: source.id },
      include: { tabs: { orderBy: { position: 'asc' } } }
    });
  });
}

export async function refreshSourceWithTabs(input: {
  workspaceId: string;
  sourceId: string;
  source: SourceDetailsUpdateInput;
  tabs: SourceWithTabsInput['tabs'];
}) {
  return prisma.$transaction(async (tx) => {
    const existingSource = await tx.dataSource.findFirstOrThrow({
      where: { id: input.sourceId, workspaceId: input.workspaceId },
      include: { tabs: true }
    });
    const plan = buildTabRefreshPlan({
      dataSourceId: existingSource.id,
      existingTabs: existingSource.tabs,
      inspectedTabs: input.tabs
    });

    await tx.dataSource.update({
      where: { id: existingSource.id },
      data: input.source
    });

    for (const update of plan.updates) {
      await tx.dataSourceTab.update({
        where: { id: update.id },
        data: update.data
      });
    }

    if (plan.creates.length > 0) {
      await tx.dataSourceTab.createMany({ data: plan.creates });
    }

    return tx.dataSource.findUniqueOrThrow({
      where: { id: existingSource.id },
      include: { tabs: { orderBy: { position: 'asc' } } }
    });
  });
}

export async function updateSourceDetails(input: {
  workspaceId: string;
  sourceId: string;
  data: SourceDetailsUpdateInput;
}) {
  const result = await prisma.dataSource.updateMany({
    where: { id: input.sourceId, workspaceId: input.workspaceId },
    data: input.data
  });
  if (result.count === 0) {
    throw new SourceNotFoundError('Source not found.');
  }
  return findSourceWithTabs(input.workspaceId, input.sourceId);
}

export async function updateSourceHealth(input: {
  workspaceId: string;
  sourceId: string;
  connectionStatus?: DataSourceCreateInput['connectionStatus'];
  lastError?: string | null;
}) {
  return updateSourceDetails({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    data: {
      connectionStatus: input.connectionStatus,
      lastError: input.lastError ?? null,
      lastValidatedAt: new Date()
    }
  });
}

export async function updateSourceTab(input: {
  workspaceId: string;
  sourceId: string;
  tabId: string;
  isEnabled: boolean;
}) {
  const result = await prisma.dataSourceTab.updateMany({
    where: {
      id: input.tabId,
      dataSource: {
        id: input.sourceId,
        workspaceId: input.workspaceId,
        archivedAt: null
      }
    },
    data: { isEnabled: input.isEnabled }
  });
  if (result.count === 0) {
    throw new SourceNotFoundError('Source tab not found.');
  }
  return findSourceWithTabs(input.workspaceId, input.sourceId);
}

export async function archiveSource(workspaceId: string, sourceId: string) {
  const result = await prisma.dataSource.updateMany({
    where: { id: sourceId, workspaceId },
    data: {
      archivedAt: new Date(),
      connectionStatus: 'ARCHIVED',
      syncEnabled: false
    }
  });
  if (result.count === 0) {
    throw new SourceNotFoundError('Source not found.');
  }
  return findSourceWithTabs(workspaceId, sourceId);
}

export async function createDataSourceTab(input: DataSourceTabCreateInput) {
  return prisma.dataSourceTab.create({
    data: {
      dataSourceId: input.dataSourceId,
      externalTabId: input.externalTabId,
      name: input.name,
      position: input.position ?? null,
      headersJson: input.headersJson,
      headerHash: input.headerHash ?? null,
      rowCount: input.rowCount ?? 0
    }
  });
}

export async function createSourceSnapshot(input: SourceSnapshotCreateInput) {
  return prisma.sourceSnapshot.create({
    data: {
      dataSourceId: input.dataSourceId,
      sourceTabId: input.sourceTabId ?? null,
      version: input.version,
      status: input.status || 'CREATED',
      checksum: input.checksum ?? null,
      rawFileKey: input.rawFileKey ?? null
    }
  });
}

export async function createSourceRow(input: SourceRowCreateInput) {
  return prisma.sourceRow.create({
    data: {
      workspaceId: input.workspaceId,
      dataSourceId: input.dataSourceId,
      sourceTabId: input.sourceTabId,
      externalRowId: input.externalRowId,
      rowHash: input.rowHash,
      rawData: input.rawData,
      normalizedData: input.normalizedData,
      rowNumber: input.rowNumber ?? null,
      automationId: input.automationId ?? null,
      email: input.email ?? null,
      fullName: input.fullName ?? null,
      leadStatus: input.leadStatus ?? null,
      demoDate: input.demoDate ?? null,
      demoTime: input.demoTime ?? null,
      meetingLink: input.meetingLink ?? null,
      remarks: input.remarks ?? null,
      validationStatus: input.validationStatus || 'VALID',
      validationErrors: input.validationErrors,
      canonicalLeadId: input.canonicalLeadId ?? null
    }
  });
}
