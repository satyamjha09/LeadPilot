import { prisma } from '../../db';
import { normalizeLeadEmail } from './lead.matcher';
import type { LeadCreateInput, LeadIdentityCreateInput } from './lead.types';

export async function findLeadByNormalizedEmail(workspaceId: string, email: string) {
  return prisma.lead.findUnique({
    where: {
      workspaceId_normalizedEmail: {
        workspaceId,
        normalizedEmail: normalizeLeadEmail(email) || ''
      }
    }
  });
}

export async function createLead(input: LeadCreateInput) {
  const normalizedEmail = input.normalizedEmail ?? normalizeLeadEmail(input.primaryEmail);
  return prisma.lead.create({
    data: {
      workspaceId: input.workspaceId,
      primaryEmail: input.primaryEmail ?? null,
      normalizedEmail,
      fullName: input.fullName ?? null,
      status: input.status ?? null
    }
  });
}

export async function upsertLeadByEmail(input: LeadCreateInput & { primaryEmail: string }) {
  const normalizedEmail = input.normalizedEmail ?? normalizeLeadEmail(input.primaryEmail);
  if (!normalizedEmail) {
    throw new Error('Lead email is required for email upsert.');
  }

  return prisma.lead.upsert({
    where: {
      workspaceId_normalizedEmail: {
        workspaceId: input.workspaceId,
        normalizedEmail
      }
    },
    update: {
      primaryEmail: input.primaryEmail,
      fullName: input.fullName ?? undefined,
      status: input.status ?? undefined
    },
    create: {
      workspaceId: input.workspaceId,
      primaryEmail: input.primaryEmail,
      normalizedEmail,
      fullName: input.fullName ?? null,
      status: input.status ?? null
    }
  });
}

export async function addLeadIdentity(input: LeadIdentityCreateInput) {
  return prisma.leadIdentity.create({
    data: {
      ...input,
      scopeKey: input.scopeKey || 'workspace'
    }
  });
}

export async function findLeadIdentity(input: {
  workspaceId: string;
  type: LeadIdentityCreateInput['type'];
  scopeKey?: string;
  value: string;
}) {
  return prisma.leadIdentity.findUnique({
    where: {
      workspaceId_type_scopeKey_value: {
        workspaceId: input.workspaceId,
        type: input.type,
        scopeKey: input.scopeKey || 'workspace',
        value: input.value
      }
    },
    include: { lead: true }
  });
}
