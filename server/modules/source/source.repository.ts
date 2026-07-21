import { prisma } from '../../db';
import type {
  DataSourceCreateInput,
  DataSourceTabCreateInput,
  SourceRowCreateInput,
  SourceSnapshotCreateInput
} from './source.types';

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

export async function listDataSourcesForWorkspace(workspaceId: string) {
  return prisma.dataSource.findMany({
    where: { workspaceId, archivedAt: null },
    orderBy: { updatedAt: 'desc' },
    include: { tabs: true }
  });
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
