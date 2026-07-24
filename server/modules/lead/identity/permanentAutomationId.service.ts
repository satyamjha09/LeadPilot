import { Prisma } from '@prisma/client';
import { prisma } from '../../../db';
import { createNewAutomationId } from '../../../emailIdentity';
import { normalizeLeadEmail } from '../../../scheduleDb';
import type { ExcelRow } from '../../../../src/types';
import type { EmailBrandKey } from '../../../../src/lib/emailBrand';

const AUTOMATION_ID_SCOPE = 'workspace';

export class AutomationIdentityConflictError extends Error {
  code = 'AUTOMATION_IDENTITY_CONFLICT';
  statusCode = 409;
  automationIds: string[];

  constructor(automationIds: string[], message = 'Multiple automation_id values match this lead. Manual review is required.') {
    super(message);
    this.name = 'AutomationIdentityConflictError';
    this.automationIds = automationIds;
  }
}

export class MissingPermanentAutomationIdError extends Error {
  code = 'MISSING_PERMANENT_AUTOMATION_ID';
  statusCode = 400;

  constructor(message = 'Permanent automation_id is required before processing workflow rows.') {
    super(message);
    this.name = 'MissingPermanentAutomationIdError';
  }
}

function clean(value: unknown) {
  return String(value || '').trim();
}

function uniqueAutomationIds(values: unknown[]) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function chooseUnambiguous(values: unknown[]) {
  const ids = uniqueAutomationIds(values);
  if (ids.length > 1) throw new AutomationIdentityConflictError(ids);
  return ids[0] || '';
}

function sourceRowId(row: ExcelRow) {
  return clean(row.__sourceRowId);
}

async function ensureWorkspace(workspaceKey: EmailBrandKey) {
  return prisma.workspace.upsert({
    where: { key: workspaceKey },
    update: {},
    create: {
      key: workspaceKey,
      name: workspaceKey === 'anywheretally' ? 'AnyWhereTally' : 'TallyKonnect'
    }
  });
}

async function findOrCreateCanonicalLead(input: {
  workspaceId: string;
  email: string;
  fullName?: string;
  sourceRow?: { canonicalLeadId?: string | null } | null;
}) {
  if (input.sourceRow?.canonicalLeadId) {
    const existing = await prisma.lead.findFirst({
      where: { id: input.sourceRow.canonicalLeadId, workspaceId: input.workspaceId, mergedIntoLeadId: null }
    });
    if (existing) return existing;
  }

  if (input.email) {
    return prisma.lead.upsert({
      where: {
        workspaceId_normalizedEmail: {
          workspaceId: input.workspaceId,
          normalizedEmail: input.email
        }
      },
      update: {
        primaryEmail: input.email,
        fullName: input.fullName || undefined,
        lastMatchedAt: new Date()
      },
      create: {
        workspaceId: input.workspaceId,
        primaryEmail: input.email,
        normalizedEmail: input.email,
        fullName: input.fullName || null,
        lastMatchedAt: new Date()
      }
    });
  }

  return prisma.lead.create({
    data: {
      workspaceId: input.workspaceId,
      fullName: input.fullName || null,
      lastMatchedAt: new Date()
    }
  });
}

async function legacyAutomationIdByBrandEmail(emailBrand: EmailBrandKey, email: string) {
  if (!email) return [];
  const rows = await prisma.leadSchedule.findMany({
    where: {
      emailBrand,
      email,
      automationId: { not: null }
    },
    select: { automationId: true },
    distinct: ['automationId']
  });
  return uniqueAutomationIds(rows.map((row) => row.automationId));
}

async function lifecycleAutomationIdByBrandEmail(emailBrand: EmailBrandKey, email: string) {
  if (!email) return [];
  const [states, histories] = await Promise.all([
    prisma.customerDemoState.findMany({
      where: {
        emailBrand,
        email: { equals: email, mode: 'insensitive' }
      },
      select: { userId: true }
    }),
    prisma.demoHistory.findMany({
      where: {
        emailBrand,
        email: { equals: email, mode: 'insensitive' }
      },
      select: { userId: true }
    })
  ]);

  return uniqueAutomationIds([
    ...states.map((state) => state.userId),
    ...histories.map((history) => history.userId)
  ].filter((userId) => !clean(userId).includes('@')));
}

async function automationIdFromCanonicalLead(leadId?: string | null) {
  if (!leadId) return [];
  const identities = await prisma.leadIdentity.findMany({
    where: {
      leadId,
      type: 'AUTOMATION_ID',
      scopeKey: AUTOMATION_ID_SCOPE
    },
    select: { value: true }
  });
  return uniqueAutomationIds(identities.map((identity) => identity.value));
}

async function automationIdFromSiblingRows(leadId?: string | null) {
  if (!leadId) return [];
  const rows = await prisma.sourceRow.findMany({
    where: {
      canonicalLeadId: leadId,
      automationId: { not: null },
      isActive: true
    },
    select: { automationId: true },
    distinct: ['automationId']
  });
  return uniqueAutomationIds(rows.map((row) => row.automationId));
}

async function lockCanonicalLeadIdentity(tx: Prisma.TransactionClient, workspaceId: string, leadId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation-id:${workspaceId}:${leadId}`}, 0))::text`;
}

async function persistIdentity(input: {
  row: ExcelRow;
  workspaceId: string;
  candidateAutomationIds: unknown[];
  sourceRow?: { id: string; canonicalLeadId?: string | null } | null;
  leadId: string;
}) {
  return prisma.$transaction(async (tx) => {
    await lockCanonicalLeadIdentity(tx, input.workspaceId, input.leadId);

    const leadIdentities = await tx.leadIdentity.findMany({
      where: {
        leadId: input.leadId,
        type: 'AUTOMATION_ID',
        scopeKey: AUTOMATION_ID_SCOPE
      },
      select: { id: true, leadId: true, value: true }
    });
    const automationId = chooseUnambiguous([
      ...input.candidateAutomationIds,
      ...leadIdentities.map((identity) => identity.value)
    ]) || createNewAutomationId();

    const existingIdentityForValue = await tx.leadIdentity.findUnique({
      where: {
        workspaceId_type_scopeKey_value: {
          workspaceId: input.workspaceId,
          type: 'AUTOMATION_ID',
          scopeKey: AUTOMATION_ID_SCOPE,
          value: automationId
        }
      }
    });

    if (existingIdentityForValue && existingIdentityForValue.leadId !== input.leadId) {
      throw new AutomationIdentityConflictError(
        [automationId],
        'automation_id is already assigned to another lead. Manual review is required.'
      );
    }
    if (leadIdentities.length > 1) {
      throw new AutomationIdentityConflictError(
        leadIdentities.map((identity) => identity.value),
        'Multiple permanent automation_id values are assigned to this lead. Manual review is required.'
      );
    }
    if (
      leadIdentities.length === 1 &&
      leadIdentities[0].value !== automationId
    ) {
      throw new AutomationIdentityConflictError(
        [leadIdentities[0].value, automationId],
        'Multiple automation_id values match this lead. Manual review is required.'
      );
    }

    const identity = existingIdentityForValue
      ? await tx.leadIdentity.update({
          where: { id: existingIdentityForValue.id },
          data: {
            source: 'AUTO',
            isVerified: true
          }
        })
      : await tx.leadIdentity.create({
          data: {
            workspaceId: input.workspaceId,
            leadId: input.leadId,
            type: 'AUTOMATION_ID',
            scopeKey: AUTOMATION_ID_SCOPE,
            value: automationId,
            source: 'AUTO',
            isVerified: true
          }
        });

    if (input.sourceRow?.id) {
      await tx.sourceRow.update({
        where: { id: input.sourceRow.id },
        data: {
          automationId,
          canonicalLeadId: input.leadId,
          leadMatchStatus: 'MATCHED',
          leadMatchedAt: new Date()
        }
      });

      await tx.leadIdentityObservation.upsert({
        where: {
          leadIdentityId_sourceRowId: {
            leadIdentityId: identity.id,
            sourceRowId: input.sourceRow.id
          }
        },
        update: {
          isActive: true,
          lastSeenAt: new Date()
        },
        create: {
          workspaceId: input.workspaceId,
          leadIdentityId: identity.id,
          sourceRowId: input.sourceRow.id,
          isActive: true
        }
      });

      await tx.sourceRow.updateMany({
        where: {
          canonicalLeadId: input.leadId,
          automationId: null
        },
        data: { automationId }
      });
    }

    return { identity, automationId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function resolvePermanentAutomationId(input: {
  row: ExcelRow;
  workspaceKey: EmailBrandKey;
  emailBrand: EmailBrandKey;
}) {
  const existing = clean(input.row.automation_id || input.row.automationId);
  const email = normalizeLeadEmail(input.row.email);
  const workspace = await ensureWorkspace(input.workspaceKey);
  const sourceId = sourceRowId(input.row);
  const sourceRow = sourceId
    ? await prisma.sourceRow.findFirst({
        where: { id: sourceId, workspaceId: workspace.id },
        select: { id: true, automationId: true, canonicalLeadId: true, email: true, fullName: true }
      })
    : null;

  const sourceAutomationId = clean(sourceRow?.automationId);
  const lead = await findOrCreateCanonicalLead({
    workspaceId: workspace.id,
    email: email || normalizeLeadEmail(sourceRow?.email),
    fullName: clean(input.row.full_name || sourceRow?.fullName),
    sourceRow
  });

  const permanentDbAutomationId = chooseUnambiguous([
    ...(await automationIdFromCanonicalLead(lead.id)),
    ...(await lifecycleAutomationIdByBrandEmail(input.emailBrand, email))
  ]);
  const fallbackCandidates = permanentDbAutomationId
    ? [permanentDbAutomationId]
    : [
        existing,
        sourceAutomationId,
        ...(await automationIdFromSiblingRows(lead.id)),
        ...(await legacyAutomationIdByBrandEmail(input.emailBrand, email))
      ];
  const persisted = await persistIdentity({
    row: input.row,
    workspaceId: workspace.id,
    candidateAutomationIds: fallbackCandidates,
    sourceRow,
    leadId: lead.id
  });

  return {
    automationId: persisted.automationId,
    canonicalLeadId: lead.id,
    sourceRowId: sourceRow?.id || sourceId || undefined
  };
}
