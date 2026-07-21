import type { LeadIdentitySource, LeadIdentityType } from '@prisma/client';

export type LeadCreateInput = {
  workspaceId: string;
  primaryEmail?: string | null;
  normalizedEmail?: string | null;
  fullName?: string | null;
  status?: string | null;
};

export type LeadIdentityCreateInput = {
  workspaceId: string;
  leadId: string;
  type: LeadIdentityType;
  scopeKey?: string;
  value: string;
  source?: LeadIdentitySource;
  isVerified?: boolean;
};

export type LeadMatchInput = {
  workspaceId: string;
  email?: string | null;
  phone?: string | null;
  automationId?: string | null;
  crmId?: string | null;
};
