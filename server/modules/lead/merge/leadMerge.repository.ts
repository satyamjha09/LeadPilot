import { Prisma } from '@prisma/client';

import { prisma } from '../../../db';
import { SourceConflictError, SourceNotFoundError } from '../../source/sourceErrors';

export async function mergeLeads(input: {
  workspaceId: string;
  sourceLeadId: string;
  targetLeadId: string;
  note?: string;
}) {
  if (input.sourceLeadId === input.targetLeadId) {
    throw new SourceConflictError('Cannot merge a lead into itself.');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "Lead"
      WHERE "id" IN (${Prisma.join([input.sourceLeadId, input.targetLeadId])})
      FOR UPDATE
    `;

    const [sourceLead, targetLead] = await Promise.all([
      tx.lead.findFirst({ where: { id: input.sourceLeadId, workspaceId: input.workspaceId } }),
      tx.lead.findFirst({ where: { id: input.targetLeadId, workspaceId: input.workspaceId } })
    ]);

    if (!sourceLead || !targetLead) {
      throw new SourceNotFoundError('Lead not found.');
    }
    if (sourceLead.mergedIntoLeadId || targetLead.mergedIntoLeadId) {
      throw new SourceConflictError('Already merged leads cannot be merged again.');
    }

    const sourceIdentities = await tx.leadIdentity.findMany({
      where: { leadId: sourceLead.id }
    });
    let movedIdentityCount = 0;

    for (const identity of sourceIdentities) {
      const duplicate = await tx.leadIdentity.findUnique({
        where: {
          workspaceId_type_scopeKey_value: {
            workspaceId: identity.workspaceId,
            type: identity.type,
            scopeKey: identity.scopeKey,
            value: identity.value
          }
        }
      });

      if (duplicate && duplicate.leadId === targetLead.id) {
        await tx.leadIdentityObservation.updateMany({
          where: { leadIdentityId: identity.id },
          data: { leadIdentityId: duplicate.id }
        });
        await tx.leadIdentity.delete({ where: { id: identity.id } });
      } else {
        await tx.leadIdentity.update({
          where: { id: identity.id },
          data: { leadId: targetLead.id }
        });
      }
      movedIdentityCount += 1;
    }

    const movedSourceRows = await tx.sourceRow.updateMany({
      where: { canonicalLeadId: sourceLead.id },
      data: {
        canonicalLeadId: targetLead.id,
        leadMatchStatus: 'MATCHED',
        leadMatchReason: 'MANUAL_LEAD_MERGE',
        leadMatchedAt: new Date()
      }
    });

    await tx.leadMatchResult.updateMany({
      where: { leadId: sourceLead.id },
      data: { leadId: targetLead.id }
    });

    await tx.leadMatchConflict.updateMany({
      where: {
        workspaceId: input.workspaceId,
        status: 'OPEN',
        OR: [{ resolvedLeadId: sourceLead.id }, { sourceRow: { canonicalLeadId: targetLead.id } }]
      },
      data: {
        status: 'RESOLVED',
        resolvedLeadId: targetLead.id,
        resolutionNote: input.note || 'Resolved by lead merge.',
        resolvedAt: new Date()
      }
    });

    await tx.lead.update({
      where: { id: sourceLead.id },
      data: {
        status: 'MERGED',
        mergedIntoLeadId: targetLead.id,
        mergedAt: new Date(),
        normalizedEmail: null
      }
    });

    await tx.lead.update({
      where: { id: targetLead.id },
      data: { lastMatchedAt: new Date() }
    });

    return tx.leadMergeHistory.create({
      data: {
        workspaceId: input.workspaceId,
        sourceLeadId: sourceLead.id,
        targetLeadId: targetLead.id,
        movedSourceRowCount: movedSourceRows.count,
        movedIdentityCount,
        note: input.note
      }
    });
  });
}
