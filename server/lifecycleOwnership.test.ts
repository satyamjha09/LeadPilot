import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExcelRow } from '../src/types';
import { EmailBrandMismatchError } from './brandOwnership';

const scheduleDbMock = vi.hoisted(() => ({
  assertDemoBrandOwnership: vi.fn()
}));

vi.mock('./scheduleDb', () => scheduleDbMock);

const { assertProcessBatchBrandOwnership } = await import('./lifecycleOwnership');

const baseRow: ExcelRow = {
  id: 'row-1',
  full_name: 'Moh Agarwal',
  email: 'moh@example.com',
  automation_id: 'lead_123',
  'Date of Demo': '15-06-2026',
  'Time of Demo': '15:30'
};

describe('lifecycle batch brand ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleDbMock.assertDemoBrandOwnership.mockResolvedValue({
      emailBrand: 'tallykonnect',
      state: {},
      history: {}
    });
  });

  it('allows a new unowned Demo Scheduled row to choose either brand', async () => {
    const result = await assertProcessBatchBrandOwnership(
      [{ ...baseRow, lead_status: 'Demo Scheduled' }],
      'anywheretally'
    );

    expect(result).toEqual({
      selectedBrand: 'anywheretally',
      lockedBrand: undefined,
      lockedBrands: []
    });
    expect(scheduleDbMock.assertDemoBrandOwnership).not.toHaveBeenCalled();
  });

  it('rejects rows locked to both brands in one batch', async () => {
    await expect(
      assertProcessBatchBrandOwnership(
        [
          { ...baseRow, id: 'row-1', __emailBrand: 'tallykonnect' },
          { ...baseRow, id: 'row-2', __emailBrand: 'anywheretally' }
        ],
        'tallykonnect'
      )
    ).rejects.toMatchObject({
      code: 'MIXED_EMAIL_BRAND_BATCH',
      statusCode: 409,
      brands: ['tallykonnect', 'anywheretally']
    });
  });

  it('rejects a TallyKonnect reschedule when AnyWhereTally is selected', async () => {
    scheduleDbMock.assertDemoBrandOwnership.mockRejectedValue(
      new EmailBrandMismatchError('tallykonnect', 'anywheretally')
    );

    await expect(
      assertProcessBatchBrandOwnership(
        [{ ...baseRow, lead_status: 'Reschedule' }],
        'anywheretally'
      )
    ).rejects.toMatchObject({
      code: 'EMAIL_BRAND_MISMATCH',
      statusCode: 409,
      requiredBrand: 'tallykonnect',
      selectedBrand: 'anywheretally'
    });
  });

  it('uses the active demo owner for Demo Done locks', async () => {
    const result = await assertProcessBatchBrandOwnership(
      [{ ...baseRow, lead_status: 'Demo Done' }],
      'tallykonnect'
    );

    expect(result.lockedBrand).toBe('tallykonnect');
    expect(scheduleDbMock.assertDemoBrandOwnership).toHaveBeenCalledWith(
      expect.objectContaining({ lead_status: 'Demo Done' }),
      'tallykonnect'
    );
  });

  it('uses the active demo owner for Not Attended locks', async () => {
    const result = await assertProcessBatchBrandOwnership(
      [{ ...baseRow, lead_status: 'Not Attended' }],
      'tallykonnect'
    );

    expect(result.lockedBrand).toBe('tallykonnect');
    expect(scheduleDbMock.assertDemoBrandOwnership).toHaveBeenCalledWith(
      expect.objectContaining({ lead_status: 'Not Attended' }),
      'tallykonnect'
    );
  });
});
