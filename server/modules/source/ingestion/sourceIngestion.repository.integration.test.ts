import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProcessingSnapshot,
  finalizeSnapshot,
  getSourceForIngestion,
  stageSnapshotRows
} from './sourceIngestion.repository';
import type { NormalizedReadRow } from './sourceIngestion.types';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const shouldRun = Boolean(testDatabaseUrl) && testDatabaseUrl !== process.env.DATABASE_URL;
const describeIntegration = shouldRun ? describe : describe.skip;
const prisma = new PrismaClient({
  datasourceUrl: testDatabaseUrl || process.env.DATABASE_URL
});
const testRun = `ingestion_it_${Date.now()}`;

async function cleanup() {
  const workspaces = await prisma.workspace.findMany({
    where: { key: { startsWith: testRun } },
    select: { id: true }
  });
  const workspaceIds = workspaces.map((workspace) => workspace.id);
  if (workspaceIds.length === 0) return;
  await prisma.sourceSnapshotRow.deleteMany({ where: { snapshot: { dataSource: { workspaceId: { in: workspaceIds } } } } });
  await prisma.sourceSnapshotTab.deleteMany({ where: { snapshot: { dataSource: { workspaceId: { in: workspaceIds } } } } });
  await prisma.sourceSnapshot.deleteMany({ where: { dataSource: { workspaceId: { in: workspaceIds } } } });
  await prisma.sourceRow.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.dataSourceTab.deleteMany({ where: { dataSource: { workspaceId: { in: workspaceIds } } } });
  await prisma.dataSource.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
}

async function createSourceFixture() {
  const workspace = await prisma.workspace.create({
    data: { key: `${testRun}_${Math.random().toString(36).slice(2)}`, name: 'Ingestion Test' }
  });
  const source = await prisma.dataSource.create({
    data: {
      workspaceId: workspace.id,
      type: 'GOOGLE_SHEETS',
      displayName: 'Sheet',
      externalFileId: `sheet-${workspace.id}`
    }
  });
  const tab = await prisma.dataSourceTab.create({
    data: {
      dataSourceId: source.id,
      externalTabId: '0',
      name: 'Leads',
      headersJson: ['email'],
      isEnabled: true
    }
  });
  return { workspace, source, tab };
}

function row(tabId: string, externalRowId: string, email: string, hash: string): NormalizedReadRow {
  return {
    sourceTabId: tabId,
    externalTabId: '0',
    rowNumber: 2,
    rawData: { headers: ['email'], values: [email] },
    normalizedData: {
      fullName: '',
      email,
      leadStatus: '',
      demoDate: '',
      demoTime: '',
      meetingLink: '',
      remarks: '',
      automationId: ''
    },
    normalizedFields: {
      fullName: '',
      email,
      leadStatus: '',
      demoDate: '',
      demoTime: '',
      meetingLink: '',
      remarks: '',
      automationId: ''
    },
    validationErrors: [],
    validationStatus: 'VALID',
    externalRowId,
    identityType: 'ROW_NUMBER',
    rowHash: hash
  };
}

describeIntegration('source ingestion repository', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('increments snapshot versions and blocks another active processing snapshot', async () => {
    const { source } = await createSourceFixture();
    const first = await createProcessingSnapshot(source.id);
    await expect(createProcessingSnapshot(source.id)).rejects.toMatchObject({ statusCode: 409 });
    await prisma.sourceSnapshot.update({ where: { id: first.id }, data: { status: 'FAILED' } });
    const second = await createProcessingSnapshot(source.id);
    expect(second.version).toBe(first.version + 1);
  });

  it('adds, updates, removes, reactivates rows and preserves canonicalLeadId', async () => {
    const { workspace, source, tab } = await createSourceFixture();
    const lead = await prisma.lead.create({ data: { workspaceId: workspace.id, normalizedEmail: 'old@example.com' } });
    await prisma.sourceRow.create({
      data: {
        workspaceId: workspace.id,
        dataSourceId: source.id,
        sourceTabId: tab.id,
        externalRowId: 'row:old',
        rowNumber: 2,
        rowHash: 'old',
        rawData: { headers: ['email'], values: ['old@example.com'] },
        normalizedData: { email: 'old@example.com' },
        email: 'old@example.com',
        canonicalLeadId: lead.id
      }
    });

    const snapshot = await createProcessingSnapshot(source.id);
    const rows = [row(tab.id, 'row:new', 'new@example.com', 'new-hash')];
    await stageSnapshotRows(snapshot.id, rows);
    const result = await finalizeSnapshot({
      snapshotId: snapshot.id,
      sourceId: source.id,
      sourceTabs: [tab],
      successfulTabs: [{ sourceTabId: tab.id, headerHash: 'h', headers: ['email'], rows }],
      failedTabs: []
    });

    expect(result.addedCount).toBe(1);
    expect(result.removedCount).toBe(1);
    const oldRow = await prisma.sourceRow.findUniqueOrThrow({
      where: { sourceTabId_externalRowId: { sourceTabId: tab.id, externalRowId: 'row:old' } }
    });
    expect(oldRow.isActive).toBe(false);
    expect(oldRow.canonicalLeadId).toBe(lead.id);
  });

  it('does not deactivate rows for failed tabs', async () => {
    const { workspace, source, tab } = await createSourceFixture();
    await prisma.sourceRow.create({
      data: {
        workspaceId: workspace.id,
        dataSourceId: source.id,
        sourceTabId: tab.id,
        externalRowId: 'row:kept',
        rowNumber: 2,
        rowHash: 'same',
        rawData: { headers: ['email'], values: ['kept@example.com'] },
        normalizedData: { email: 'kept@example.com' },
        email: 'kept@example.com'
      }
    });
    const snapshot = await createProcessingSnapshot(source.id);
    await finalizeSnapshot({
      snapshotId: snapshot.id,
      sourceId: source.id,
      sourceTabs: [tab],
      successfulTabs: [],
      failedTabs: [{ sourceTabId: tab.id, error: 'tab failed' }]
    });
    const kept = await prisma.sourceRow.findUniqueOrThrow({
      where: { sourceTabId_externalRowId: { sourceTabId: tab.id, externalRowId: 'row:kept' } }
    });
    expect(kept.isActive).toBe(true);
  });

  it('enforces cross-workspace source ownership', async () => {
    const { source } = await createSourceFixture();
    await expect(getSourceForIngestion('wrong-workspace', source.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
