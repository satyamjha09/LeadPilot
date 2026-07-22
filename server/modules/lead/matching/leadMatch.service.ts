import { Prisma } from '@prisma/client';

import { parseEmailBrand } from '../../../../src/lib/emailBrand';
import { getWorkspaceOrThrow } from '../../workspace/workspace.service';
import { SourceConflictError, SourceValidationError, safeErrorMessage } from '../../source/sourceErrors';
import { buildIdentityCandidates } from './leadIdentityNormalizer';
import { planLeadMatches, summarizePlans } from './leadMatchPlanner';
import type { MatchPlan } from './leadMatch.types';
import {
  applyLeadMatchPlans,
  assertSourceTabForLeadMatching,
  createLeadMatchRun,
  failLeadMatchRun,
  getCanonicalLead,
  getLeadConflict,
  getLeadMatchRun,
  getSnapshotForLeadMatching,
  getSourceForLeadMatching,
  ignoreLeadConflict,
  listCanonicalLeads,
  listEligibleRowsForSnapshot,
  listLeadConflicts,
  listLeadMatchRuns,
  prefetchIdentityClaims,
  resolveLeadConflictLink
} from './leadMatch.repository';

const CONFLICT_TYPES = new Set([
  'MULTIPLE_LEADS',
  'IDENTITY_OWNED_BY_ANOTHER_LEAD',
  'LINKED_LEAD_CHANGED',
  'NO_STRONG_IDENTITY',
  'INVALID_IDENTITY'
]);

function parseLimit(value: unknown) {
  const parsed = Number(value || 50);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(Math.floor(parsed), 200);
}

function parseConflictType(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !CONFLICT_TYPES.has(value)) {
    throw new SourceValidationError('Invalid lead conflict type filter.');
  }
  return value;
}

function parseBatchSize() {
  const parsed = Number(process.env.LEAD_MATCH_BATCH_SIZE || 250);
  if (!Number.isFinite(parsed) || parsed <= 0) return 250;
  return Math.min(Math.floor(parsed), 1000);
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function getWorkspaceSource(workspaceKey: string, sourceId: string) {
  const brand = parseEmailBrand(workspaceKey);
  const workspace = await getWorkspaceOrThrow(brand);
  const source = await getSourceForLeadMatching(workspace.id, sourceId);
  return { workspace, source };
}

async function buildPlans(workspaceKey: string, sourceId: string, snapshotId: string) {
  if (!snapshotId || typeof snapshotId !== 'string') {
    throw new SourceValidationError('snapshotId is required.');
  }
  const { workspace, source } = await getWorkspaceSource(workspaceKey, sourceId);
  await getSnapshotForLeadMatching(source.id, snapshotId);
  const rows = await listEligibleRowsForSnapshot(source.id, snapshotId);
  const plans: MatchPlan[] = [];
  for (const batch of chunkRows(rows, parseBatchSize())) {
    const identities = batch.flatMap(buildIdentityCandidates);
    const claims = await prefetchIdentityClaims(workspace.id, identities);
    plans.push(...planLeadMatches(batch, claims));
  }
  return { workspace, source, rows, plans };
}

export async function previewLeadMatching(workspaceKey: string, sourceId: string, snapshotId: string) {
  const { plans } = await buildPlans(workspaceKey, sourceId, snapshotId);
  return summarizePlans(plans);
}

export async function runLeadMatching(workspaceKey: string, sourceId: string, snapshotId: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { workspace, source, plans } = await buildPlans(workspaceKey, sourceId, snapshotId);
    const existingActive = await listLeadMatchRuns(source.id, undefined, 1);
    if (existingActive.some((run) => run.status === 'PROCESSING')) {
      throw new SourceConflictError('A lead match run is already processing this source.');
    }
    const run = await createLeadMatchRun({
      workspaceId: workspace.id,
      dataSourceId: source.id,
      snapshotId
    });

    try {
      return await applyLeadMatchPlans({
        runId: run.id,
        workspaceId: workspace.id,
        plans
      });
    } catch (error) {
      await failLeadMatchRun(run.id, safeErrorMessage(error));
      if (
        attempt < 3 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new SourceConflictError('Lead matching failed after retrying identity conflicts.');
}

export async function listWorkspaceLeadMatchRuns(workspaceKey: string, sourceId: string, cursor?: string, limit?: unknown) {
  const { source } = await getWorkspaceSource(workspaceKey, sourceId);
  const take = parseLimit(limit);
  const rows = await listLeadMatchRuns(source.id, cursor, take);
  return { runs: rows.slice(0, take), nextCursor: rows.length > take ? rows[take].id : null };
}

export async function getWorkspaceLeadMatchRun(workspaceKey: string, sourceId: string, runId: string) {
  const { source } = await getWorkspaceSource(workspaceKey, sourceId);
  return getLeadMatchRun(source.id, runId);
}

export async function listWorkspaceLeadConflicts(
  workspaceKey: string,
  query: {
    status?: 'OPEN' | 'RESOLVED' | 'IGNORED';
    sourceId?: string;
    type?: any;
    cursor?: string;
    limit?: unknown;
  }
) {
  const brand = parseEmailBrand(workspaceKey);
  const workspace = await getWorkspaceOrThrow(brand);
  const limit = parseLimit(query.limit);
  if (query.sourceId) {
    await getSourceForLeadMatching(workspace.id, query.sourceId);
  }
  const conflicts = await listLeadConflicts({
    workspaceId: workspace.id,
    status: query.status,
    sourceId: query.sourceId,
    type: parseConflictType(query.type),
    cursor: query.cursor,
    limit
  });
  return { conflicts: conflicts.slice(0, limit), nextCursor: conflicts.length > limit ? conflicts[limit].id : null };
}

export async function updateWorkspaceLeadConflict(
  workspaceKey: string,
  conflictId: string,
  input: { action: 'LINK_EXISTING' | 'IGNORE'; leadId?: string; note?: string }
) {
  const brand = parseEmailBrand(workspaceKey);
  const workspace = await getWorkspaceOrThrow(brand);
  await getLeadConflict(workspace.id, conflictId);

  if (input.action === 'IGNORE') {
    await ignoreLeadConflict(workspace.id, conflictId, input.note);
    return getLeadConflict(workspace.id, conflictId);
  }

  if (!input.leadId) {
    throw new SourceConflictError('leadId is required for LINK_EXISTING.');
  }

  return resolveLeadConflictLink({
    workspaceId: workspace.id,
    conflictId,
    leadId: input.leadId,
    note: input.note
  });
}

export async function listWorkspaceCanonicalLeads(
  workspaceKey: string,
  query: {
    search?: string;
    sourceId?: string;
    tabId?: string;
    hasConflict?: string;
    includeMerged?: string;
    cursor?: string;
    limit?: unknown;
  }
) {
  const brand = parseEmailBrand(workspaceKey);
  const workspace = await getWorkspaceOrThrow(brand);
  const limit = parseLimit(query.limit);
  if (query.sourceId) {
    await getSourceForLeadMatching(workspace.id, query.sourceId);
  }
  if (query.tabId) {
    await assertSourceTabForLeadMatching({
      workspaceId: workspace.id,
      sourceId: query.sourceId,
      tabId: query.tabId
    });
  }
  const leads = await listCanonicalLeads({
    workspaceId: workspace.id,
    search: query.search,
    sourceId: query.sourceId,
    tabId: query.tabId,
    hasConflict: query.hasConflict === 'true',
    includeMerged: query.includeMerged === 'true',
    cursor: query.cursor,
    limit
  });

  return {
    leads: leads.slice(0, limit).map((lead) => {
      const sourceIds = new Set(lead.sourceRows.map((row) => row.dataSourceId));
      const sourceSummaries = Array.from(
        new Map(
          lead.sourceRows.map((row) => [
            row.dataSourceId,
            { sourceId: row.dataSourceId, displayName: row.dataSource.displayName }
          ])
        ).values()
      );
      return {
        id: lead.id,
        primaryEmail: lead.primaryEmail,
        fullName: lead.fullName,
        activeSourceRowCount: lead.sourceRows.length,
        sourceCount: sourceIds.size,
        openConflictCount: lead.sourceRows.reduce((count, row) => count + row.matchConflicts.length, 0),
        lastMatchedAt: lead.lastMatchedAt,
        sources: sourceSummaries
      };
    }),
    nextCursor: leads.length > limit ? leads[limit].id : null
  };
}

export async function getWorkspaceCanonicalLead(workspaceKey: string, leadId: string) {
  const brand = parseEmailBrand(workspaceKey);
  const workspace = await getWorkspaceOrThrow(brand);
  return getCanonicalLead(workspace.id, leadId);
}
