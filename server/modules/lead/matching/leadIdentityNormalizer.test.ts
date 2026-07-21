import type { SourceRow } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  buildIdentityCandidates,
  isValidLeadPhoneIdentity,
  normalizeLeadEmailIdentity,
  normalizeLeadPhoneIdentity
} from './leadIdentityNormalizer';
import { identityScopeKey } from './leadIdentityScope';

function sourceRow(overrides: Partial<SourceRow>): SourceRow {
  return {
    id: 'row-1',
    workspaceId: 'workspace-1',
    dataSourceId: 'source-1',
    sourceTabId: 'tab-1',
    externalRowId: 'row:1',
    rowNumber: 1,
    identityType: 'ROW_NUMBER',
    rowHash: 'hash',
    rawData: {},
    normalizedData: {},
    automationId: null,
    email: null,
    phone: null,
    crmId: null,
    fullName: null,
    leadStatus: null,
    demoDate: null,
    demoTime: null,
    meetingLink: null,
    remarks: null,
    validationStatus: 'VALID',
    validationErrors: null,
    canonicalLeadId: null,
    leadMatchStatus: 'UNMATCHED',
    leadMatchReason: null,
    leadMatchedAt: null,
    leadMatchStrategyVersion: null,
    isActive: true,
    lastSeenAt: new Date(),
    firstSeenVersion: 1,
    lastSeenVersion: 1,
    deactivatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

describe('lead identity normalization', () => {
  it('normalizes email and phone without inferring a country code', () => {
    expect(normalizeLeadEmailIdentity('  RAHUL@Example.COM ')).toBe('rahul@example.com');
    expect(normalizeLeadPhoneIdentity('+91 881-784-4439')).toBe('+918817844439');
    expect(normalizeLeadPhoneIdentity('881 784 4439')).toBe('8817844439');
    expect(normalizeLeadPhoneIdentity('8817844439')).not.toBe('+918817844439');
  });

  it('validates phone length using 8 to 15 digits', () => {
    expect(isValidLeadPhoneIdentity('1234567')).toBe(false);
    expect(isValidLeadPhoneIdentity('12345678')).toBe(true);
    expect(isValidLeadPhoneIdentity('+123456789012345')).toBe(true);
    expect(isValidLeadPhoneIdentity('+1234567890123456')).toBe(false);
  });

  it('uses workspace scope for email and phone and source scope for source IDs', () => {
    expect(identityScopeKey('EMAIL', 'source-1')).toBe('workspace');
    expect(identityScopeKey('PHONE', 'source-1')).toBe('workspace');
    expect(identityScopeKey('CRM_ID', 'source-1')).toBe('source:source-1');
    expect(identityScopeKey('AUTOMATION_ID', 'source-1')).toBe('source:source-1');
  });

  it('builds candidates from deterministic identities only', () => {
    const candidates = buildIdentityCandidates(
      sourceRow({
        fullName: 'Same Name Is Not Used',
        email: 'A@EXAMPLE.COM',
        phone: ' 881-784-4439 ',
        crmId: ' CRM-42 ',
        automationId: ' auto-42 '
      })
    );

    expect(candidates.map((candidate) => candidate.type)).toEqual(['EMAIL', 'PHONE', 'CRM_ID', 'AUTOMATION_ID']);
    expect(candidates.find((candidate) => candidate.type === 'CRM_ID')).toMatchObject({
      scopeKey: 'source:source-1',
      value: 'CRM-42',
      isStrong: true
    });
    expect(candidates.find((candidate) => candidate.type === 'AUTOMATION_ID')).toMatchObject({
      scopeKey: 'source:source-1',
      value: 'auto-42',
      isStrong: false
    });
  });
});
