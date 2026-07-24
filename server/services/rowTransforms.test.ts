import { describe, expect, it } from 'vitest';
import { normalizeRows } from './rowTransforms';

describe('normalizeRows automation_id handling', () => {
  it('does not generate a new automation_id during basic import', () => {
    const [row] = normalizeRows([
      {
        full_name: 'Satyam 1',
        email: 'codekar81@gmail.com',
        lead_status: 'Demo Scheduled',
        'Date of Demo': '24-07-2099',
        'Time of Demo': '16:30'
      }
    ]);

    expect(row.automation_id).toBe('');
  });

  it('preserves an existing automation_id from the source row', () => {
    const [row] = normalizeRows([
      {
        full_name: 'Satyam 1',
        email: 'codekar81@gmail.com',
        lead_status: 'Demo Scheduled',
        'Date of Demo': '24-07-2099',
        'Time of Demo': '16:30',
        automation_id: 'lead_existing'
      }
    ]);

    expect(row.automation_id).toBe('lead_existing');
  });
});
