import type { LeadIdentityType, SourceRow } from '@prisma/client';

export type IdentityCandidate = {
  type: LeadIdentityType;
  scopeKey: string;
  value: string;
  isStrong: boolean;
};

export type IdentityClaim = IdentityCandidate & {
  leadId: string;
};

export type MatchPlanStatus = 'CREATED' | 'MATCHED' | 'UNCHANGED' | 'CONFLICT' | 'SKIPPED';

export type MatchPlan = {
  sourceRow: SourceRow;
  identities: IdentityCandidate[];
  candidateLeadIds: string[];
  status: MatchPlanStatus;
  reasonCode?: string;
  conflictType?: 'MULTIPLE_LEADS' | 'LINKED_LEAD_CHANGED' | 'NO_STRONG_IDENTITY' | 'INVALID_IDENTITY';
};

export type LeadMatchPreviewSummary = {
  eligibleRows: number;
  wouldCreateLeads: number;
  wouldMatchExisting: number;
  wouldRemainUnchanged: number;
  wouldConflict: number;
  wouldSkip: number;
};
