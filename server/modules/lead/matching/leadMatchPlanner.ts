import type { SourceRow } from '@prisma/client';

import { buildIdentityCandidates } from './leadIdentityNormalizer';
import type { IdentityClaim, MatchPlan } from './leadMatch.types';

export function planLeadMatches(rows: SourceRow[], claims: IdentityClaim[]) {
  const claimsByIdentity = new Map<string, IdentityClaim>();
  for (const claim of claims) {
    claimsByIdentity.set(`${claim.type}:${claim.scopeKey}:${claim.value}`, claim);
  }

  return rows.map((row): MatchPlan => {
    const identities = buildIdentityCandidates(row);
    const strongIdentities = identities.filter((identity) => identity.isStrong);
    const candidateLeadIds = Array.from(
      new Set(
        identities
          .map((identity) => claimsByIdentity.get(`${identity.type}:${identity.scopeKey}:${identity.value}`)?.leadId)
          .filter(Boolean) as string[]
      )
    );

    if (identities.length === 0 || strongIdentities.length === 0) {
      return {
        sourceRow: row,
        identities,
        candidateLeadIds,
        status: 'SKIPPED',
        reasonCode: 'NO_STRONG_IDENTITY'
      };
    }

    if (row.canonicalLeadId && candidateLeadIds.length > 0 && !candidateLeadIds.includes(row.canonicalLeadId)) {
      return {
        sourceRow: row,
        identities,
        candidateLeadIds,
        status: 'CONFLICT',
        conflictType: 'LINKED_LEAD_CHANGED',
        reasonCode: 'LINKED_LEAD_CHANGED'
      };
    }

    if (candidateLeadIds.length > 1) {
      return {
        sourceRow: row,
        identities,
        candidateLeadIds,
        status: 'CONFLICT',
        conflictType: 'MULTIPLE_LEADS',
        reasonCode: 'MULTIPLE_LEADS'
      };
    }

    if (candidateLeadIds.length === 0) {
      return {
        sourceRow: row,
        identities,
        candidateLeadIds,
        status: 'CREATED'
      };
    }

    return {
      sourceRow: row,
      identities,
      candidateLeadIds,
      status: row.canonicalLeadId === candidateLeadIds[0] ? 'UNCHANGED' : 'MATCHED'
    };
  });
}

export function summarizePlans(plans: MatchPlan[]) {
  return {
    eligibleRows: plans.length,
    wouldCreateLeads: plans.filter((plan) => plan.status === 'CREATED').length,
    wouldMatchExisting: plans.filter((plan) => plan.status === 'MATCHED').length,
    wouldRemainUnchanged: plans.filter((plan) => plan.status === 'UNCHANGED').length,
    wouldConflict: plans.filter((plan) => plan.status === 'CONFLICT').length,
    wouldSkip: plans.filter((plan) => plan.status === 'SKIPPED').length
  };
}
