import type { SourceRow } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { planLeadMatches, summarizePlans } from './leadMatchPlanner';
import type { IdentityClaim } from './leadMatch.types';

function row(overrides: Partial<SourceRow>): SourceRow {
  return {
    id: overrides.id || 'row-1',
    workspaceId: 'workspace-1',
    dataSourceId: overrides.dataSourceId || 'source-1',
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

const claim = (overrides: Partial<IdentityClaim>): IdentityClaim => ({
  type: 'EMAIL',
  scopeKey: 'workspace',
  value: 'a@example.com',
  isStrong: true,
  leadId: 'lead-1',
  ...overrides
});

describe('lead match planner exact-v1', () => {
  it('creates a lead for a row with a strong identity and no candidates', () => {
    const [plan] = planLeadMatches([row({ email: 'a@example.com' })], []);
    expect(plan.status).toBe('CREATED');
  });

  it('skips automation-only rows because automation id is not a strong identity', () => {
    const [plan] = planLeadMatches([row({ automationId: 'auto-1' })], []);
    expect(plan).toMatchObject({ status: 'SKIPPED', reasonCode: 'NO_STRONG_IDENTITY' });
  });

  it('matches the same email across different sources to one candidate lead', () => {
    const plans = planLeadMatches(
      [
        row({ id: 'row-a', dataSourceId: 'source-a', email: 'rahul@example.com' }),
        row({ id: 'row-b', dataSourceId: 'source-b', email: 'rahul@example.com' })
      ],
      [claim({ value: 'rahul@example.com', leadId: 'lead-rahul' })]
    );

    expect(plans.map((plan) => plan.status)).toEqual(['MATCHED', 'MATCHED']);
    expect(plans.every((plan) => plan.candidateLeadIds[0] === 'lead-rahul')).toBe(true);
  });

  it('does not merge rows only because names are equal', () => {
    const plans = planLeadMatches(
      [
        row({ id: 'row-a', fullName: 'Rahul' }),
        row({ id: 'row-b', fullName: 'Rahul' })
      ],
      []
    );
    expect(plans.map((plan) => plan.status)).toEqual(['SKIPPED', 'SKIPPED']);
  });

  it('keeps same automation IDs scoped to their own source', () => {
    const plans = planLeadMatches(
      [
        row({ id: 'row-a', dataSourceId: 'source-a', email: 'a@example.com', automationId: 'auto-1' }),
        row({ id: 'row-b', dataSourceId: 'source-b', email: 'b@example.com', automationId: 'auto-1' })
      ],
      [
        claim({ type: 'AUTOMATION_ID', scopeKey: 'source:source-a', value: 'auto-1', isStrong: false, leadId: 'lead-a' })
      ]
    );

    expect(plans[0]).toMatchObject({ status: 'MATCHED', candidateLeadIds: ['lead-a'] });
    expect(plans[1]).toMatchObject({ status: 'CREATED', candidateLeadIds: [] });
  });

  it('creates conflicts for identity disagreements and linked lead changes', () => {
    const [multiLead] = planLeadMatches(
      [row({ email: 'a@example.com', phone: '9999999999' })],
      [
        claim({ type: 'EMAIL', value: 'a@example.com', leadId: 'lead-a' }),
        claim({ type: 'PHONE', value: '9999999999', leadId: 'lead-b' })
      ]
    );
    const [changedLink] = planLeadMatches(
      [row({ email: 'b@example.com', canonicalLeadId: 'lead-old' })],
      [claim({ value: 'b@example.com', leadId: 'lead-new' })]
    );

    expect(multiLead).toMatchObject({ status: 'CONFLICT', conflictType: 'MULTIPLE_LEADS' });
    expect(changedLink).toMatchObject({ status: 'CONFLICT', conflictType: 'LINKED_LEAD_CHANGED' });
  });

  it('summarizes preview counts without writing anything', () => {
    const summary = summarizePlans([
      { ...planLeadMatches([row({ email: 'a@example.com' })], [])[0], status: 'CREATED' },
      { ...planLeadMatches([row({ email: 'b@example.com' })], [claim({ value: 'b@example.com' })])[0], status: 'MATCHED' }
    ]);

    expect(summary).toMatchObject({
      eligibleRows: 2,
      wouldCreateLeads: 1,
      wouldMatchExisting: 1
    });
  });
});
