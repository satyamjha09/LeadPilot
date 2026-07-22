import 'dotenv/config';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyLeadMatchPlans } from './leadMatch.repository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const shouldRun = Boolean(testDatabaseUrl) && testDatabaseUrl !== process.env.DATABASE_URL;
const describeIntegration = shouldRun ? describe : describe.skip;
const prisma = new PrismaClient({
  datasourceUrl: testDatabaseUrl || process.env.DATABASE_URL
});
const testRun = `lead_match_it_${Date.now()}`;

async function cleanup() {
  const workspaces = await prisma.workspace.findMany({
    where: { key: { startsWith: testRun } },
    select: { id: true }
  });
  const workspaceIds = workspaces.map((workspace) => workspace.id);
  if (workspaceIds.length === 0) return;

  await prisma.leadMatchConflict.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.leadMatchResult.deleteMany({ where: { run: { workspaceId: { in: workspaceIds } } } });
  await prisma.leadMatchRun.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.leadIdentityObservation.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.sourceSnapshotRow.deleteMany({ where: { snapshot: { dataSource: { workspaceId: { in: workspaceIds } } } } });
  await prisma.sourceSnapshotTab.deleteMany({ where: { snapshot: { dataSource: { workspaceId: { in: workspaceIds } } } } });
  await prisma.sourceSnapshot.deleteMany({ where: { dataSource: { workspaceId: { in: workspaceIds } } } });
  await prisma.sourceRow.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.leadIdentity.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.leadMergeHistory.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.lead.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.dataSourceTab.deleteMany({ where: { dataSource: { workspaceId: { in: workspaceIds } } } });
  await prisma.dataSource.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
}

async function expectUniqueConstraint(action: () => Promise<unknown>) {
  await expect(action()).rejects.toMatchObject({
    code: 'P2002'
  } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
}

async function fixture() {
  const workspace = await prisma.workspace.create({
    data: { key: `${testRun}_${Math.random().toString(36).slice(2)}`, name: 'Lead Match Test' }
  });
  const [sourceA, sourceB] = await Promise.all([
    prisma.dataSource.create({
      data: {
        workspaceId: workspace.id,
        type: 'GOOGLE_SHEETS',
        displayName: 'Sheet A',
        externalFileId: `sheet-a-${workspace.id}`
      }
    }),
    prisma.dataSource.create({
      data: {
        workspaceId: workspace.id,
        type: 'EXCEL',
        displayName: 'Workbook B',
        externalFileId: `excel-b-${workspace.id}`,
        checksum: `checksum-${workspace.id}`
      }
    })
  ]);
  const [leadA, leadB] = await Promise.all([
    prisma.lead.create({ data: { workspaceId: workspace.id, normalizedEmail: `a-${workspace.id}@example.com` } }),
    prisma.lead.create({ data: { workspaceId: workspace.id, normalizedEmail: `b-${workspace.id}@example.com` } })
  ]);
  return { workspace, sourceA, sourceB, leadA, leadB };
}

describeIntegration('canonical lead matching database constraints', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('scopes automation IDs per source while keeping email workspace-unique', async () => {
    const { workspace, sourceA, sourceB, leadA, leadB } = await fixture();

    await prisma.leadIdentity.create({
      data: {
        workspaceId: workspace.id,
        leadId: leadA.id,
        type: 'AUTOMATION_ID',
        scopeKey: `source:${sourceA.id}`,
        value: 'auto-1'
      }
    });
    await prisma.leadIdentity.create({
      data: {
        workspaceId: workspace.id,
        leadId: leadB.id,
        type: 'AUTOMATION_ID',
        scopeKey: `source:${sourceB.id}`,
        value: 'auto-1'
      }
    });

    await prisma.leadIdentity.create({
      data: {
        workspaceId: workspace.id,
        leadId: leadA.id,
        type: 'EMAIL',
        scopeKey: 'workspace',
        value: 'same@example.com'
      }
    });

    await expectUniqueConstraint(() =>
      prisma.leadIdentity.create({
        data: {
          workspaceId: workspace.id,
          leadId: leadB.id,
          type: 'EMAIL',
          scopeKey: 'workspace',
          value: 'same@example.com'
        }
      })
    );
  });

  it('allows only one processing match run per source', async () => {
    const { workspace, sourceA } = await fixture();
    const snapshot = await prisma.sourceSnapshot.create({
      data: {
        dataSourceId: sourceA.id,
        version: 1,
        status: 'COMPLETED'
      }
    });

    await prisma.leadMatchRun.create({
      data: {
        workspaceId: workspace.id,
        dataSourceId: sourceA.id,
        snapshotId: snapshot.id
      }
    });

    await expectUniqueConstraint(() =>
      prisma.leadMatchRun.create({
        data: {
          workspaceId: workspace.id,
          dataSourceId: sourceA.id,
          snapshotId: snapshot.id
        }
      })
    );
  });

  it('does not reassign an existing identity to another lead during apply', async () => {
    const { workspace, sourceA, leadA, leadB } = await fixture();
    const tab = await prisma.dataSourceTab.create({
      data: {
        dataSourceId: sourceA.id,
        externalTabId: '0',
        name: 'Leads',
        headersJson: ['email'],
        isEnabled: true
      }
    });
    const row = await prisma.sourceRow.create({
      data: {
        workspaceId: workspace.id,
        dataSourceId: sourceA.id,
        sourceTabId: tab.id,
        externalRowId: 'row:2',
        rowNumber: 2,
        rowHash: 'hash',
        rawData: { headers: ['email'], values: ['owned@example.com'] },
        normalizedData: { email: 'owned@example.com' },
        email: 'owned@example.com'
      }
    });
    await prisma.leadIdentity.create({
      data: {
        workspaceId: workspace.id,
        leadId: leadB.id,
        type: 'EMAIL',
        scopeKey: 'workspace',
        value: 'owned@example.com'
      }
    });
    const snapshot = await prisma.sourceSnapshot.create({
      data: { dataSourceId: sourceA.id, version: 1, status: 'COMPLETED' }
    });
    const run = await prisma.leadMatchRun.create({
      data: {
        workspaceId: workspace.id,
        dataSourceId: sourceA.id,
        snapshotId: snapshot.id
      }
    });

    await expect(
      applyLeadMatchPlans({
        runId: run.id,
        workspaceId: workspace.id,
        plans: [
          {
            sourceRow: row,
            identities: [
              {
                type: 'EMAIL',
                scopeKey: 'workspace',
                value: 'owned@example.com',
                isStrong: true
              }
            ],
            candidateLeadIds: [leadA.id],
            status: 'MATCHED'
          }
        ]
      })
    ).rejects.toThrow('Identity is already owned by another lead');

    const identity = await prisma.leadIdentity.findUniqueOrThrow({
      where: {
        workspaceId_type_scopeKey_value: {
          workspaceId: workspace.id,
          type: 'EMAIL',
          scopeKey: 'workspace',
          value: 'owned@example.com'
        }
      }
    });
    expect(identity.leadId).toBe(leadB.id);
  });
});
