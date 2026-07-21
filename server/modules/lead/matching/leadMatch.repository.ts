import { Prisma, type Lead, type SourceRow } from '@prisma/client';

import { prisma } from '../../../db';
import { SourceConflictError, SourceNotFoundError } from '../../source/sourceErrors';
import { LEAD_MATCH_STRATEGY_VERSION } from './leadMatchStrategy';
import type { IdentityCandidate, IdentityClaim, MatchPlan } from './leadMatch.types';

function staleMinutes() {
  const configured = Number(process.env.LEAD_MATCH_STALE_MINUTES || 30);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
}

export async function getSourceForLeadMatching(workspaceId: string, sourceId: string) {
  const source = await prisma.dataSource.findFirst({
    where: { id: sourceId, workspaceId },
    include: { tabs: true }
  });
  if (!source) throw new SourceNotFoundError('Source not found.');
  return source;
}

export async function getSnapshotForLeadMatching(sourceId: string, snapshotId: string) {
  const snapshot = await prisma.sourceSnapshot.findFirst({
    where: { id: snapshotId, dataSourceId: sourceId, status: { in: ['COMPLETED', 'PARTIAL'] } },
    include: { tabResults: true }
  });
  if (!snapshot) throw new SourceNotFoundError('Completed source snapshot not found.');
  return snapshot;
}

export async function listEligibleRowsForSnapshot(sourceId: string, snapshotId: string) {
  const snapshot = await getSnapshotForLeadMatching(sourceId, snapshotId);
  const completedTabIds = snapshot.tabResults
    .filter((tab) => tab.status === 'COMPLETED')
    .map((tab) => tab.sourceTabId);

  if (completedTabIds.length === 0) return [];

  return prisma.sourceRow.findMany({
    where: {
      dataSourceId: sourceId,
      sourceTabId: { in: completedTabIds },
      isActive: true,
      validationStatus: { in: ['VALID', 'WARNING'] },
      lastSeenVersion: snapshot.version
    },
    orderBy: [{ sourceTabId: 'asc' }, { rowNumber: 'asc' }]
  });
}

export async function prefetchIdentityClaims(workspaceId: string, identities: IdentityCandidate[]) {
  if (identities.length === 0) return [];

  const unique = Array.from(
    new Map(identities.map((identity) => [`${identity.type}:${identity.scopeKey}:${identity.value}`, identity])).values()
  );

  const records = await prisma.leadIdentity.findMany({
    where: {
      workspaceId,
      OR: unique.map((identity) => ({
        type: identity.type,
        scopeKey: identity.scopeKey,
        value: identity.value
      }))
    }
  });

  return records.map((record) => ({
    type: record.type,
    scopeKey: record.scopeKey,
    value: record.value,
    isStrong: record.type !== 'AUTOMATION_ID',
    leadId: record.leadId
  })) satisfies IdentityClaim[];
}

export async function markStaleLeadMatchRunsFailed(sourceId: string) {
  const cutoff = new Date(Date.now() - staleMinutes() * 60 * 1000);
  await prisma.leadMatchRun.updateMany({
    where: {
      dataSourceId: sourceId,
      status: 'PROCESSING',
      startedAt: { lt: cutoff }
    },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      error: 'Processing match run was marked failed because it became stale.'
    }
  });
}

export async function createLeadMatchRun(input: {
  workspaceId: string;
  dataSourceId: string;
  snapshotId: string;
}) {
  await markStaleLeadMatchRunsFailed(input.dataSourceId);

  try {
    return await prisma.leadMatchRun.create({
      data: {
        workspaceId: input.workspaceId,
        dataSourceId: input.dataSourceId,
        snapshotId: input.snapshotId,
        strategyVersion: LEAD_MATCH_STRATEGY_VERSION,
        status: 'PROCESSING'
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new SourceConflictError('A lead match run is already processing this source.');
    }
    throw error;
  }
}

function leadCreateDataFromRow(row: SourceRow) {
  return {
    workspaceId: row.workspaceId,
    primaryEmail: row.email || null,
    normalizedEmail: row.email || null,
    fullName: row.fullName || null,
    lastMatchedAt: new Date()
  };
}

async function ensureIdentity(
  tx: Prisma.TransactionClient,
  lead: Lead,
  row: SourceRow,
  identity: IdentityCandidate,
  source: 'AUTO' | 'MANUAL' = 'AUTO'
) {
  const record = await tx.leadIdentity.upsert({
    where: {
      workspaceId_type_scopeKey_value: {
        workspaceId: row.workspaceId,
        type: identity.type,
        scopeKey: identity.scopeKey,
        value: identity.value
      }
    },
    update: {
      leadId: lead.id
    },
    create: {
      workspaceId: row.workspaceId,
      leadId: lead.id,
      type: identity.type,
      scopeKey: identity.scopeKey,
      value: identity.value,
      source,
      isVerified: identity.type === 'EMAIL' || identity.type === 'PHONE'
    }
  });

  await tx.leadIdentityObservation.upsert({
    where: {
      leadIdentityId_sourceRowId: {
        leadIdentityId: record.id,
        sourceRowId: row.id
      }
    },
    update: {
      isActive: row.isActive,
      lastSeenAt: new Date()
    },
    create: {
      workspaceId: row.workspaceId,
      leadIdentityId: record.id,
      sourceRowId: row.id,
      isActive: row.isActive
    }
  });

  return record;
}

async function fillCanonicalFields(tx: Prisma.TransactionClient, lead: Lead, row: SourceRow) {
  const data: Prisma.LeadUpdateInput = {
    lastMatchedAt: new Date()
  };
  if (!lead.primaryEmail && row.email) data.primaryEmail = row.email;
  if (!lead.normalizedEmail && row.email) data.normalizedEmail = row.email;
  if (!lead.fullName && row.fullName) data.fullName = row.fullName;

  return tx.lead.update({
    where: { id: lead.id },
    data
  });
}

async function findExistingLeadForCreatedPlan(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  row: SourceRow,
  identities: IdentityCandidate[]
) {
  if (identities.length > 0) {
    const identityRecords = await tx.leadIdentity.findMany({
      where: {
        workspaceId,
        OR: identities.map((identity) => ({
          type: identity.type,
          scopeKey: identity.scopeKey,
          value: identity.value
        }))
      }
    });
    const leadIds = Array.from(new Set(identityRecords.map((identity) => identity.leadId)));
    if (leadIds.length === 1) {
      return tx.lead.findUnique({ where: { id: leadIds[0] } });
    }
  }

  if (row.email) {
    return tx.lead.findUnique({
      where: {
        workspaceId_normalizedEmail: {
          workspaceId,
          normalizedEmail: row.email
        }
      }
    });
  }

  return null;
}

export async function applyLeadMatchPlans(input: {
  runId: string;
  workspaceId: string;
  plans: MatchPlan[];
}) {
  return prisma.$transaction(async (tx) => {
    let createdLeadCount = 0;
    let matchedRowCount = 0;
    let unchangedRowCount = 0;
    let conflictCount = 0;
    let skippedCount = 0;

    for (const plan of input.plans) {
      const row = plan.sourceRow;
      const identitiesJson = plan.identities as unknown as Prisma.InputJsonValue;
      const candidateLeadIds = plan.candidateLeadIds as unknown as Prisma.InputJsonValue;

      if (plan.status === 'SKIPPED') {
        skippedCount += 1;
        await tx.sourceRow.update({
          where: { id: row.id },
          data: {
            leadMatchStatus: 'SKIPPED',
            leadMatchReason: plan.reasonCode || 'NO_STRONG_IDENTITY',
            leadMatchStrategyVersion: LEAD_MATCH_STRATEGY_VERSION
          }
        });
        await tx.leadMatchResult.create({
          data: {
            runId: input.runId,
            sourceRowId: row.id,
            status: 'SKIPPED',
            reasonCode: plan.reasonCode,
            identitiesJson,
            candidateLeadIds
          }
        });
        continue;
      }

      if (plan.status === 'CONFLICT') {
        conflictCount += 1;
        await tx.sourceRow.update({
          where: { id: row.id },
          data: {
            leadMatchStatus: 'CONFLICT',
            leadMatchReason: plan.reasonCode,
            leadMatchStrategyVersion: LEAD_MATCH_STRATEGY_VERSION
          }
        });
        await tx.leadMatchResult.create({
          data: {
            runId: input.runId,
            sourceRowId: row.id,
            status: 'CONFLICT',
            reasonCode: plan.reasonCode,
            identitiesJson,
            candidateLeadIds
          }
        });
        await tx.leadMatchConflict.create({
          data: {
            workspaceId: input.workspaceId,
            runId: input.runId,
            sourceRowId: row.id,
            type: plan.conflictType || 'MULTIPLE_LEADS',
            identityClaims: identitiesJson,
            candidateLeadIds,
            message: plan.reasonCode || 'Lead identity conflict.'
          }
        });
        continue;
      }

      let lead: Lead;
      let resultStatus = plan.status;
      if (plan.status === 'CREATED') {
        const existingLead = await findExistingLeadForCreatedPlan(tx, input.workspaceId, row, plan.identities);
        if (existingLead) {
          lead = await fillCanonicalFields(tx, existingLead, row);
          matchedRowCount += 1;
          resultStatus = 'MATCHED';
        } else {
          lead = await tx.lead.create({
            data: leadCreateDataFromRow(row)
          });
          createdLeadCount += 1;
        }
      } else {
        lead = await tx.lead.findUniqueOrThrow({
          where: { id: plan.candidateLeadIds[0] }
        });
        lead = await fillCanonicalFields(tx, lead, row);
        if (plan.status === 'UNCHANGED') {
          unchangedRowCount += 1;
        } else {
          matchedRowCount += 1;
        }
      }

      for (const identity of plan.identities) {
        await ensureIdentity(tx, lead, row, identity);
      }

      await tx.sourceRow.update({
        where: { id: row.id },
        data: {
          canonicalLeadId: lead.id,
          leadMatchStatus: 'MATCHED',
          leadMatchReason: resultStatus,
          leadMatchedAt: new Date(),
          leadMatchStrategyVersion: LEAD_MATCH_STRATEGY_VERSION
        }
      });

      await tx.leadMatchResult.create({
        data: {
          runId: input.runId,
          sourceRowId: row.id,
          leadId: lead.id,
          status: resultStatus,
          reasonCode: resultStatus,
          identitiesJson,
          candidateLeadIds
        }
      });
    }

    await tx.leadIdentityObservation.updateMany({
      where: {
        sourceRow: {
          workspaceId: input.workspaceId,
          isActive: false
        }
      },
      data: { isActive: false }
    });

    return tx.leadMatchRun.update({
      where: { id: input.runId },
      data: {
        status: 'COMPLETED',
        rowCount: input.plans.length,
        createdLeadCount,
        matchedRowCount,
        unchangedRowCount,
        conflictCount,
        skippedCount,
        completedAt: new Date()
      }
    });
  });
}

export async function failLeadMatchRun(runId: string, error: string) {
  return prisma.leadMatchRun.update({
    where: { id: runId },
    data: {
      status: 'FAILED',
      error,
      completedAt: new Date()
    }
  });
}

export async function listLeadMatchRuns(sourceId: string, cursor?: string, limit = 50) {
  return prisma.leadMatchRun.findMany({
    where: { dataSourceId: sourceId },
    orderBy: { startedAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
  });
}

export async function getLeadMatchRun(sourceId: string, runId: string) {
  const run = await prisma.leadMatchRun.findFirst({
    where: { id: runId, dataSourceId: sourceId },
    include: { results: true, conflicts: true }
  });
  if (!run) throw new SourceNotFoundError('Lead match run not found.');
  return run;
}

export async function listLeadConflicts(input: {
  workspaceId: string;
  status?: 'OPEN' | 'RESOLVED' | 'IGNORED';
  sourceId?: string;
  type?: any;
  cursor?: string;
  limit: number;
}) {
  return prisma.leadMatchConflict.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.sourceId ? { sourceRow: { dataSourceId: input.sourceId } } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { sourceRow: true }
  });
}

export async function getLeadConflict(workspaceId: string, conflictId: string) {
  const conflict = await prisma.leadMatchConflict.findFirst({
    where: { id: conflictId, workspaceId },
    include: { sourceRow: true }
  });
  if (!conflict) throw new SourceNotFoundError('Lead conflict not found.');
  return conflict;
}

export async function resolveLeadConflictLink(input: {
  workspaceId: string;
  conflictId: string;
  leadId: string;
  note?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const conflict = await tx.leadMatchConflict.findFirstOrThrow({
      where: { id: input.conflictId, workspaceId: input.workspaceId },
      include: { sourceRow: true }
    });
    const lead = await tx.lead.findFirst({
      where: { id: input.leadId, workspaceId: input.workspaceId, mergedIntoLeadId: null }
    });
    if (!lead) throw new SourceNotFoundError('Lead not found.');

    const identities = (conflict.identityClaims as unknown as IdentityCandidate[]) || [];
    const claimed = await tx.leadIdentity.findMany({
      where: {
        workspaceId: input.workspaceId,
        OR: identities.map((identity) => ({
          type: identity.type,
          scopeKey: identity.scopeKey,
          value: identity.value
        }))
      }
    });
    if (claimed.some((identity) => identity.leadId !== input.leadId)) {
      throw new SourceConflictError('Conflicting identities still belong to another lead. Merge leads first.');
    }

    for (const identity of identities) {
      await ensureIdentity(tx, lead, conflict.sourceRow, identity, 'MANUAL');
    }

    await tx.sourceRow.update({
      where: { id: conflict.sourceRowId },
      data: {
        canonicalLeadId: input.leadId,
        leadMatchStatus: 'MATCHED',
        leadMatchReason: 'MANUAL_CONFLICT_RESOLUTION',
        leadMatchedAt: new Date(),
        leadMatchStrategyVersion: LEAD_MATCH_STRATEGY_VERSION
      }
    });

    return tx.leadMatchConflict.update({
      where: { id: input.conflictId },
      data: {
        status: 'RESOLVED',
        resolvedLeadId: input.leadId,
        resolutionNote: input.note,
        resolvedAt: new Date()
      }
    });
  });
}

export async function ignoreLeadConflict(workspaceId: string, conflictId: string, note?: string) {
  return prisma.leadMatchConflict.updateMany({
    where: { id: conflictId, workspaceId },
    data: {
      status: 'IGNORED',
      resolutionNote: note,
      resolvedAt: new Date()
    }
  });
}

export async function listCanonicalLeads(input: {
  workspaceId: string;
  search?: string;
  sourceId?: string;
  tabId?: string;
  hasConflict?: boolean;
  includeMerged?: boolean;
  cursor?: string;
  limit: number;
}) {
  const sourceRowFilter: Prisma.SourceRowListRelationFilter | undefined =
    input.sourceId || input.tabId || input.hasConflict
      ? {
          some: {
            isActive: true,
            ...(input.sourceId ? { dataSourceId: input.sourceId } : {}),
            ...(input.tabId ? { sourceTabId: input.tabId } : {}),
            ...(input.hasConflict ? { matchConflicts: { some: { status: 'OPEN' } } } : {})
          }
        }
      : undefined;

  const leads = await prisma.lead.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.includeMerged ? {} : { mergedIntoLeadId: null }),
      ...(input.search
        ? {
            OR: [
              { primaryEmail: { contains: input.search, mode: 'insensitive' } },
              { fullName: { contains: input.search, mode: 'insensitive' } }
            ]
          }
        : {}),
      ...(sourceRowFilter ? { sourceRows: sourceRowFilter } : {})
    },
    orderBy: { updatedAt: 'desc' },
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: {
      sourceRows: {
        where: { isActive: true },
        include: {
          dataSource: true,
          matchConflicts: {
            where: { status: 'OPEN' },
            select: { id: true }
          }
        }
      }
    }
  });

  return leads;
}

export async function getCanonicalLead(workspaceId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: {
      identities: { include: { observations: true } },
      sourceRows: { include: { dataSource: true, sourceTab: true } },
      resolvedConflicts: { where: { status: 'OPEN' } },
      mergedInto: true,
      mergedLeads: true
    }
  });
  if (!lead) throw new SourceNotFoundError('Lead not found.');
  return lead;
}
