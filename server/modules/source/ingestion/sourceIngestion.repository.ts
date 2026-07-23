import { Prisma, type SourceRow, type SourceSnapshotStatus } from '@prisma/client';
import { prisma } from '../../../db';
import { SourceConflictError, SourceNotFoundError } from '../sourceErrors';
import type { IngestionSummary, NormalizedReadRow } from './sourceIngestion.types';

const DEFAULT_BATCH_SIZE = 250;

function batchSize() {
  const configured = Number(process.env.SOURCE_INGESTION_BATCH_SIZE || DEFAULT_BATCH_SIZE);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_BATCH_SIZE;
}

function staleMinutes() {
  const configured = Number(process.env.SOURCE_INGESTION_STALE_MINUTES || 30);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
}

function emptySummary(): IngestionSummary {
  return {
    rowCount: 0,
    addedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    removedCount: 0,
    invalidCount: 0
  };
}

function addSummary(a: IngestionSummary, b: IngestionSummary): IngestionSummary {
  return {
    rowCount: a.rowCount + b.rowCount,
    addedCount: a.addedCount + b.addedCount,
    updatedCount: a.updatedCount + b.updatedCount,
    unchangedCount: a.unchangedCount + b.unchangedCount,
    removedCount: a.removedCount + b.removedCount,
    invalidCount: a.invalidCount + b.invalidCount
  };
}

export async function getSourceForIngestion(workspaceId: string, sourceId: string) {
  const source = await prisma.dataSource.findFirst({
    where: { id: sourceId, workspaceId },
    include: { tabs: { orderBy: { position: 'asc' } } }
  });

  if (!source) {
    throw new SourceNotFoundError('Source not found.');
  }

  return source;
}

export async function assertSourceTabBelongsToSource(sourceId: string, tabId: string) {
  const tab = await prisma.dataSourceTab.findFirst({
    where: { id: tabId, dataSourceId: sourceId },
    select: { id: true }
  });
  if (!tab) throw new SourceNotFoundError('Source tab not found.');
}

export async function markStaleProcessingSnapshotsFailed(sourceId: string) {
  const cutoff = new Date(Date.now() - staleMinutes() * 60 * 1000);
  await prisma.sourceSnapshot.updateMany({
    where: {
      dataSourceId: sourceId,
      status: 'PROCESSING',
      createdAt: { lt: cutoff }
    },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      error: 'Processing snapshot was marked failed because it became stale.'
    }
  });
}

export async function createProcessingSnapshot(sourceId: string, trigger = 'MANUAL', sourceTabId?: string) {
  await markStaleProcessingSnapshotsFailed(sourceId);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const activeSnapshot = await tx.sourceSnapshot.findFirst({
          where: { dataSourceId: sourceId, status: 'PROCESSING' },
          select: { id: true }
        });
        if (activeSnapshot) {
          throw new SourceConflictError('A source ingestion is already running.');
        }

        const latest = await tx.sourceSnapshot.aggregate({
          where: { dataSourceId: sourceId },
          _max: { version: true }
        });

        return tx.sourceSnapshot.create({
          data: {
            dataSourceId: sourceId,
            sourceTabId: sourceTabId || null,
            version: (latest._max.version || 0) + 1,
            status: 'PROCESSING',
            trigger
          }
        });
      });
    } catch (error) {
      if (error instanceof SourceConflictError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && attempt < 3) {
        continue;
      }
      throw error;
    }
  }

  throw new SourceConflictError('A source ingestion is already running.');
}

export async function stageSnapshotRows(snapshotId: string, rows: NormalizedReadRow[]) {
  const size = batchSize();

  for (let index = 0; index < rows.length; index += size) {
    const batch = rows.slice(index, index + size);
    if (batch.length === 0) continue;

    await prisma.sourceSnapshotRow.createMany({
      data: batch.map((row) => ({
        snapshotId,
        sourceTabId: row.sourceTabId,
        externalRowId: row.externalRowId,
        rowNumber: row.rowNumber,
        identityType: row.identityType,
        rowHash: row.rowHash,
        rawData: row.rawData,
        normalizedData: row.normalizedData,
        automationId: row.normalizedFields.automationId || null,
        email: row.normalizedFields.email || null,
        phone: row.normalizedFields.phone || null,
        crmId: row.normalizedFields.crmId || null,
        fullName: row.normalizedFields.fullName || null,
        leadStatus: row.normalizedFields.leadStatus || null,
        demoDate: row.normalizedFields.demoDate || null,
        demoTime: row.normalizedFields.demoTime || null,
        meetingLink: row.normalizedFields.meetingLink || null,
        remarks: row.normalizedFields.remarks || null,
        validationStatus: row.validationStatus,
        validationErrors: row.validationErrors.length > 0 ? row.validationErrors : Prisma.JsonNull
      }))
    });
  }
}

export async function finalizeSnapshot(input: {
  snapshotId: string;
  sourceId: string;
  sourceTabs: Array<{ id: string; isEnabled: boolean }>;
  successfulTabs: Array<{
    sourceTabId: string;
    headerHash: string;
    headers: string[];
    rows: NormalizedReadRow[];
  }>;
  failedTabs: Array<{
    sourceTabId: string;
    headerHash?: string | null;
    error: string;
  }>;
}) {
  return prisma.$transaction(async (tx) => {
    const snapshot = await tx.sourceSnapshot.findUniqueOrThrow({
      where: { id: input.snapshotId },
      select: { version: true }
    });
    const source = await tx.dataSource.findUniqueOrThrow({
      where: { id: input.sourceId },
      select: { workspaceId: true }
    });
    let total = emptySummary();

    for (const tab of input.successfulTabs) {
      const currentRows = await tx.sourceRow.findMany({
        where: { sourceTabId: tab.sourceTabId },
        select: {
          id: true,
          externalRowId: true,
          rowHash: true,
          isActive: true,
          canonicalLeadId: true
        }
      });
      const currentByExternalId = new Map(currentRows.map((row) => [row.externalRowId, row]));
      const seenExternalIds = new Set(tab.rows.map((row) => row.externalRowId));
      const summary = emptySummary();
      summary.rowCount = tab.rows.length;
      summary.invalidCount = tab.rows.filter((row) => row.validationStatus === 'INVALID').length;

      for (const row of tab.rows) {
        const existing = currentByExternalId.get(row.externalRowId);
        if (!existing) {
          summary.addedCount += 1;
          await tx.sourceRow.create({
            data: {
              workspaceId: source.workspaceId,
              dataSourceId: input.sourceId,
              sourceTabId: tab.sourceTabId,
              externalRowId: row.externalRowId,
              rowNumber: row.rowNumber,
              identityType: row.identityType,
              rowHash: row.rowHash,
              rawData: row.rawData,
              normalizedData: row.normalizedData,
              automationId: row.normalizedFields.automationId || null,
              email: row.normalizedFields.email || null,
              phone: row.normalizedFields.phone || null,
              crmId: row.normalizedFields.crmId || null,
              fullName: row.normalizedFields.fullName || null,
              leadStatus: row.normalizedFields.leadStatus || null,
              demoDate: row.normalizedFields.demoDate || null,
              demoTime: row.normalizedFields.demoTime || null,
              meetingLink: row.normalizedFields.meetingLink || null,
              remarks: row.normalizedFields.remarks || null,
              validationStatus: row.validationStatus,
              validationErrors: row.validationErrors.length > 0 ? row.validationErrors : Prisma.JsonNull,
              isActive: true,
              firstSeenVersion: snapshot.version,
              lastSeenVersion: snapshot.version,
              lastSeenAt: new Date()
            }
          });
          continue;
        }

        if (existing.rowHash === row.rowHash && existing.isActive) {
          summary.unchangedCount += 1;
        } else {
          summary.updatedCount += 1;
        }

        await tx.sourceRow.update({
          where: { id: existing.id },
          data: {
            rowNumber: row.rowNumber,
            identityType: row.identityType,
            rowHash: row.rowHash,
            rawData: row.rawData,
            normalizedData: row.normalizedData,
            automationId: row.normalizedFields.automationId || null,
            email: row.normalizedFields.email || null,
            phone: row.normalizedFields.phone || null,
            crmId: row.normalizedFields.crmId || null,
            fullName: row.normalizedFields.fullName || null,
            leadStatus: row.normalizedFields.leadStatus || null,
            demoDate: row.normalizedFields.demoDate || null,
            demoTime: row.normalizedFields.demoTime || null,
            meetingLink: row.normalizedFields.meetingLink || null,
            remarks: row.normalizedFields.remarks || null,
            validationStatus: row.validationStatus,
            validationErrors: row.validationErrors.length > 0 ? row.validationErrors : Prisma.JsonNull,
            isActive: true,
            lastSeenAt: new Date(),
            lastSeenVersion: snapshot.version,
            deactivatedAt: null
          }
        });
      }

      const removedRows = currentRows.filter((row) => row.isActive && !seenExternalIds.has(row.externalRowId));
      summary.removedCount = removedRows.length;
      if (removedRows.length > 0) {
        await tx.sourceRow.updateMany({
          where: { id: { in: removedRows.map((row) => row.id) } },
          data: {
            isActive: false,
            deactivatedAt: new Date(),
            lastSeenVersion: snapshot.version
          }
        });
      }

      await tx.dataSourceTab.update({
        where: { id: tab.sourceTabId },
        data: {
          rowCount: tab.rows.length,
          headerHash: tab.headerHash,
          headersJson: tab.headers,
          lastSyncedAt: new Date(),
          lastError: null
        }
      });

      await tx.sourceSnapshotTab.create({
        data: {
          snapshotId: input.snapshotId,
          sourceTabId: tab.sourceTabId,
          status: 'COMPLETED',
          ...summary,
          headerHash: tab.headerHash,
          completedAt: new Date()
        }
      });

      total = addSummary(total, summary);
    }

    for (const tab of input.failedTabs) {
      await tx.sourceSnapshotTab.create({
        data: {
          snapshotId: input.snapshotId,
          sourceTabId: tab.sourceTabId,
          status: 'FAILED',
          error: tab.error,
          headerHash: tab.headerHash ?? null,
          completedAt: new Date()
        }
      });

      await tx.dataSourceTab.update({
        where: { id: tab.sourceTabId },
        data: { lastError: tab.error }
      });
    }

    const finalStatus: SourceSnapshotStatus =
      input.successfulTabs.length === 0 ? 'FAILED' : input.failedTabs.length > 0 ? 'PARTIAL' : 'COMPLETED';

    await tx.sourceSnapshot.update({
      where: { id: input.snapshotId },
      data: {
        status: finalStatus,
        ...total,
        completedAt: new Date(),
        error: finalStatus === 'FAILED' ? 'All enabled tabs failed ingestion.' : null
      }
    });

    await tx.dataSource.update({
      where: { id: input.sourceId },
      data: {
        connectionStatus: finalStatus === 'FAILED' ? 'ERROR' : 'CONNECTED',
        lastSyncedAt: new Date(),
        lastSyncStatus: finalStatus,
        lastError: finalStatus === 'FAILED' ? 'All enabled tabs failed ingestion.' : null
      }
    });

    return tx.sourceSnapshot.findUniqueOrThrow({
      where: { id: input.snapshotId },
      include: { tabResults: true }
    });
  });
}

export async function getSourceSnapshotForTab(sourceId: string, sourceTabId: string, snapshotId: string) {
  const snapshot = await prisma.sourceSnapshot.findFirst({
    where: {
      id: snapshotId,
      dataSourceId: sourceId,
      sourceTabId,
      status: { in: ['COMPLETED', 'PARTIAL'] }
    },
    include: { tabResults: true }
  });
  if (!snapshot) throw new SourceNotFoundError('Selected-tab snapshot not found.', 'SOURCE_SNAPSHOT_NOT_FOUND');
  return snapshot;
}

export async function listAllActiveSourceRowsForTab(input: {
  sourceId: string;
  sourceTabId: string;
  sourceSnapshotId?: string;
  selectedSourceRowIds?: string[];
  batchSize?: number;
}) {
  const take = input.batchSize && input.batchSize > 0 ? Math.min(input.batchSize, 500) : 250;
  const selectedIds = Array.from(new Set(input.selectedSourceRowIds?.filter(Boolean) || []));
  const snapshot = input.sourceSnapshotId
    ? await getSourceSnapshotForTab(input.sourceId, input.sourceTabId, input.sourceSnapshotId)
    : null;

  if (selectedIds.length > 0) {
    const directlySelectedRows = await prisma.sourceRow.findMany({
      where: {
        dataSourceId: input.sourceId,
        sourceTabId: input.sourceTabId,
        isActive: true,
        id: { in: selectedIds }
      },
      orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }]
    });

    if (directlySelectedRows.length === selectedIds.length) return directlySelectedRows;

    const historicalRows = await prisma.sourceRow.findMany({
      where: {
        dataSourceId: input.sourceId,
        sourceTabId: input.sourceTabId,
        id: { in: selectedIds }
      },
      select: { id: true, externalRowId: true, rowNumber: true }
    });
    const historicalById = new Map(historicalRows.map((row) => [row.id, row]));
    const rowNumbers = Array.from(
      new Set(
        historicalRows
          .map((row) => row.rowNumber)
          .filter((rowNumber): rowNumber is number => typeof rowNumber === 'number')
      )
    );
    const externalRowIds = Array.from(new Set(historicalRows.map((row) => row.externalRowId).filter(Boolean)));
    const recoveredRows =
      rowNumbers.length || externalRowIds.length
        ? await prisma.sourceRow.findMany({
            where: {
              dataSourceId: input.sourceId,
              sourceTabId: input.sourceTabId,
              isActive: true,
              OR: [
                ...(externalRowIds.length ? [{ externalRowId: { in: externalRowIds } }] : []),
                ...(rowNumbers.length ? [{ rowNumber: { in: rowNumbers } }] : [])
              ]
            },
            orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }]
          })
        : [];

    const directById = new Map(directlySelectedRows.map((row) => [row.id, row]));
    const recoveredByExternalId = new Map(recoveredRows.map((row) => [row.externalRowId, row]));
    const recoveredByRowNumber = new Map(
      recoveredRows
        .filter((row) => typeof row.rowNumber === 'number')
        .map((row) => [row.rowNumber as number, row])
    );
    const resolved = new Map<string, SourceRow>();

    for (const selectedId of selectedIds) {
      const direct = directById.get(selectedId);
      if (direct) {
        resolved.set(direct.id, direct);
        continue;
      }

      const historical = historicalById.get(selectedId);
      const current =
        (historical?.externalRowId ? recoveredByExternalId.get(historical.externalRowId) : undefined) ||
        (typeof historical?.rowNumber === 'number' ? recoveredByRowNumber.get(historical.rowNumber) : undefined);
      if (current) resolved.set(current.id, current);
    }

    if (resolved.size !== selectedIds.length) {
      throw new SourceNotFoundError('One or more selected source rows were not found in this tab.', 'SOURCE_ROW_NOT_FOUND');
    }

    return Array.from(resolved.values()).sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0) || a.id.localeCompare(b.id));
  }

  const rows: SourceRow[] = [];
  let cursor: string | undefined;

  while (true) {
    const batch = await prisma.sourceRow.findMany({
      where: {
        dataSourceId: input.sourceId,
        sourceTabId: input.sourceTabId,
        isActive: true,
        ...(snapshot ? { lastSeenVersion: snapshot.version } : {}),
        ...(selectedIds?.length ? { id: { in: selectedIds } } : {})
      },
      orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    rows.push(...batch);
    if (batch.length < take) break;
    cursor = batch[batch.length - 1].id;
  }

  return rows;
}

export async function failSnapshot(snapshotId: string, sourceId: string, error: string) {
  await prisma.sourceSnapshot.update({
    where: { id: snapshotId },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      error
    }
  });
  await prisma.dataSource.update({
    where: { id: sourceId },
    data: {
      connectionStatus: 'ERROR',
      lastSyncStatus: 'FAILED',
      lastError: error
    }
  });
}

export async function listSourceSnapshots(sourceId: string, cursor?: string, limit = 50) {
  if (cursor) {
    const cursorSnapshot = await prisma.sourceSnapshot.findFirst({
      where: { id: cursor, dataSourceId: sourceId },
      select: { id: true }
    });
    if (!cursorSnapshot) throw new SourceNotFoundError('Snapshot cursor not found.');
  }

  return prisma.sourceSnapshot.findMany({
    where: { dataSourceId: sourceId },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { tabResults: true }
  });
}

export async function getSourceSnapshot(sourceId: string, snapshotId: string) {
  const snapshot = await prisma.sourceSnapshot.findFirst({
    where: { id: snapshotId, dataSourceId: sourceId },
    include: { tabResults: true }
  });
  if (!snapshot) throw new SourceNotFoundError('Snapshot not found.');
  return snapshot;
}

export async function listCurrentSourceRows(input: {
  sourceId: string;
  tabId?: string;
  active?: boolean;
  validationStatus?: 'VALID' | 'WARNING' | 'INVALID';
  search?: string;
  cursor?: string;
  limit: number;
}) {
  if (input.tabId) {
    await assertSourceTabBelongsToSource(input.sourceId, input.tabId);
  }

  if (input.cursor) {
    const cursorRow = await prisma.sourceRow.findFirst({
      where: {
        id: input.cursor,
        dataSourceId: input.sourceId,
        ...(input.tabId ? { sourceTabId: input.tabId } : {}),
        ...(typeof input.active === 'boolean' ? { isActive: input.active } : {}),
        ...(input.validationStatus ? { validationStatus: input.validationStatus } : {}),
        ...(input.search
          ? {
              OR: [
                { email: { contains: input.search, mode: 'insensitive' } },
                { fullName: { contains: input.search, mode: 'insensitive' } },
                { automationId: { contains: input.search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      select: { id: true }
    });
    if (!cursorRow) throw new SourceNotFoundError('Source row cursor not found.');
  }

  return prisma.sourceRow.findMany({
    where: {
      dataSourceId: input.sourceId,
      ...(input.tabId ? { sourceTabId: input.tabId } : {}),
      ...(typeof input.active === 'boolean' ? { isActive: input.active } : {}),
      ...(input.validationStatus ? { validationStatus: input.validationStatus } : {}),
      ...(input.search
        ? {
            OR: [
              { email: { contains: input.search, mode: 'insensitive' } },
              { fullName: { contains: input.search, mode: 'insensitive' } },
              { automationId: { contains: input.search, mode: 'insensitive' } }
            ]
          }
        : {})
    },
    orderBy: [{ sourceTabId: 'asc' }, { rowNumber: 'asc' }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      dataSourceId: true,
      sourceTabId: true,
      externalRowId: true,
      rowNumber: true,
      identityType: true,
      rowHash: true,
      automationId: true,
      email: true,
      fullName: true,
      leadStatus: true,
      demoDate: true,
      demoTime: true,
      meetingLink: true,
      remarks: true,
      validationStatus: true,
      validationErrors: true,
      canonicalLeadId: true,
      isActive: true,
      firstSeenVersion: true,
      lastSeenVersion: true,
      deactivatedAt: true,
      lastSeenAt: true,
      createdAt: true,
      updatedAt: true
    }
  });
}

export async function getCurrentSourceRow(sourceId: string, rowId: string) {
  const row = await prisma.sourceRow.findFirst({
    where: { id: rowId, dataSourceId: sourceId }
  });
  if (!row) throw new SourceNotFoundError('Source row not found.');
  return row;
}
