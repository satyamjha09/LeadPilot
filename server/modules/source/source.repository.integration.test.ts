import 'dotenv/config';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const shouldRun = Boolean(testDatabaseUrl) && testDatabaseUrl !== process.env.DATABASE_URL;
const describeIntegration = shouldRun ? describe : describe.skip;
const prisma = new PrismaClient({
  datasourceUrl: testDatabaseUrl || process.env.DATABASE_URL
});
const testRun = `source_it_${Date.now()}`;

async function cleanup() {
  const workspaces = await prisma.workspace.findMany({
    where: { key: { startsWith: testRun } },
    select: { id: true }
  });
  const workspaceIds = workspaces.map((workspace) => workspace.id);
  if (workspaceIds.length === 0) return;

  await prisma.sourceRow.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.sourceSnapshot.deleteMany({ where: { dataSource: { workspaceId: { in: workspaceIds } } } });
  await prisma.dataSourceTab.deleteMany({ where: { dataSource: { workspaceId: { in: workspaceIds } } } });
  await prisma.dataSource.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.leadIdentity.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.lead.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
}

async function expectUniqueConstraint(action: () => Promise<unknown>) {
  await expect(action()).rejects.toMatchObject({
    code: 'P2002'
  } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
}

describeIntegration('multi-source repository database uniqueness', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('enforces workspace + type + externalFileId uniqueness', async () => {
    const workspace = await prisma.workspace.create({
      data: { key: `${testRun}_external`, name: 'External ID Test' }
    });

    await prisma.dataSource.create({
      data: {
        workspaceId: workspace.id,
        type: 'GOOGLE_SHEETS',
        displayName: 'Sheet',
        externalFileId: 'spreadsheet-1'
      }
    });

    await expectUniqueConstraint(() =>
      prisma.dataSource.create({
        data: {
          workspaceId: workspace.id,
          type: 'GOOGLE_SHEETS',
          displayName: 'Duplicate Sheet',
          externalFileId: 'spreadsheet-1'
        }
      })
    );
  });

  it('enforces workspace + type + checksum uniqueness for Excel sources', async () => {
    const workspace = await prisma.workspace.create({
      data: { key: `${testRun}_checksum`, name: 'Checksum Test' }
    });

    await prisma.dataSource.create({
      data: {
        workspaceId: workspace.id,
        type: 'EXCEL',
        displayName: 'Excel',
        externalFileId: 'excel-1',
        checksum: 'checksum-1'
      }
    });

    await expectUniqueConstraint(() =>
      prisma.dataSource.create({
        data: {
          workspaceId: workspace.id,
          type: 'EXCEL',
          displayName: 'Duplicate Excel',
          externalFileId: 'excel-2',
          checksum: 'checksum-1'
        }
      })
    );
  });

  it('enforces dataSource + externalTabId uniqueness', async () => {
    const workspace = await prisma.workspace.create({
      data: { key: `${testRun}_tabs`, name: 'Tabs Test' }
    });
    const source = await prisma.dataSource.create({
      data: {
        workspaceId: workspace.id,
        type: 'GOOGLE_SHEETS',
        displayName: 'Sheet',
        externalFileId: 'spreadsheet-tabs'
      }
    });

    await prisma.dataSourceTab.create({
      data: {
        dataSourceId: source.id,
        externalTabId: '0',
        name: 'Leads',
        headersJson: ['email']
      }
    });

    await expectUniqueConstraint(() =>
      prisma.dataSourceTab.create({
        data: {
          dataSourceId: source.id,
          externalTabId: '0',
          name: 'Renamed',
          headersJson: ['email']
        }
      })
    );
  });
});
