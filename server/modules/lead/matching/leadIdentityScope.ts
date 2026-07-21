import type { LeadIdentityType } from '@prisma/client';

export function identityScopeKey(type: LeadIdentityType, dataSourceId: string) {
  if (type === 'EMAIL' || type === 'PHONE') {
    return 'workspace';
  }
  return `source:${dataSourceId}`;
}
