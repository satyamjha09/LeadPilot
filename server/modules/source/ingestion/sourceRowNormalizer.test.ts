import { describe, expect, it } from 'vitest';

import { normalizeReadSourceTab } from './sourceRowNormalizer';

const baseTab = {
  sourceTabId: 'tab-1',
  externalTabId: '0',
  name: 'Leads',
  headers: ['full_name', 'email', 'email', 'lead_status', 'automation_id', 'Date of Demo', 'Time of Demo'],
  headerHash: 'header-hash',
  rows: []
};

describe('source row normalization', () => {
  it('preserves duplicate headers in raw data and normalizes fields', () => {
    const rows = normalizeReadSourceTab({
      ...baseTab,
      rows: [
        {
          rowNumber: 2,
          values: [' Rahul ', 'A@EXAMPLE.COM', 'backup@example.com', 'Demo Scheduled', 'auto_1', '25/07/2026', '3:00 PM']
        }
      ]
    });

    expect(rows[0].rawData).toEqual({
      headers: baseTab.headers,
      values: [' Rahul ', 'A@EXAMPLE.COM', 'backup@example.com', 'Demo Scheduled', 'auto_1', '25/07/2026', '3:00 PM']
    });
    expect(rows[0].normalizedFields).toMatchObject({
      fullName: 'Rahul',
      email: 'a@example.com',
      leadStatus: 'Demo Scheduled',
      automationId: 'auto_1'
    });
    expect(rows[0].validationErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_HEADER' })])
    );
  });

  it('uses automation identity, row-number fallback, and duplicate automation IDs safely', () => {
    const rows = normalizeReadSourceTab({
      ...baseTab,
      rows: [
        { rowNumber: 2, values: ['A', 'a@example.com', '', 'Demo Scheduled', 'auto_1', '', ''] },
        { rowNumber: 3, values: ['B', 'b@example.com', '', 'Demo Scheduled', 'auto_1', '', ''] },
        { rowNumber: 4, values: ['C', 'c@example.com', '', 'Demo Scheduled', '', '', ''] }
      ]
    });

    expect(rows[0]).toMatchObject({ externalRowId: 'automation:auto_1', identityType: 'AUTOMATION_ID' });
    expect(rows[1]).toMatchObject({
      externalRowId: 'duplicate-automation:auto_1:row:3',
      identityType: 'ROW_NUMBER',
      validationStatus: 'INVALID'
    });
    expect(rows[2]).toMatchObject({ externalRowId: 'row:4', identityType: 'ROW_NUMBER', validationStatus: 'WARNING' });
  });

  it('returns invalid status for missing email, unknown status, invalid date, and invalid time', () => {
    const [row] = normalizeReadSourceTab({
      ...baseTab,
      rows: [{ rowNumber: 2, values: ['A', '', '', 'Alien Status', '', 'not-a-date', '99:99'] }]
    });

    expect(row.validationStatus).toBe('INVALID');
    expect(row.validationErrors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['MISSING_EMAIL', 'UNKNOWN_LEAD_STATUS', 'INVALID_DATE', 'INVALID_TIME'])
    );
  });

  it('produces stable row hashes for unchanged rows', () => {
    const input = {
      ...baseTab,
      rows: [{ rowNumber: 2, values: ['A', 'a@example.com', '', 'Demo Scheduled', 'auto_1', '', ''] }]
    };

    expect(normalizeReadSourceTab(input)[0].rowHash).toBe(normalizeReadSourceTab(input)[0].rowHash);
  });
});
