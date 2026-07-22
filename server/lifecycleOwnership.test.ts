import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExcelRow } from '../src/types';
import { EmailBrandMismatchError, SenderAccountMismatchError } from './brandOwnership';

const scheduleDbMock = vi.hoisted(() => ({
  assertDemoBrandOwnership: vi.fn(),
  assertDemoLifecycleOwnership: vi.fn()
}));

vi.mock('./scheduleDb', () => scheduleDbMock);

const { assertProcessBatchBrandOwnership } = await import('./lifecycleOwnership');
const { assertProcessBatchLifecycleOwnership } = await import('./lifecycleOwnership');

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
      senderAccountKey: 'tallykonnect-google',
      state: {},
      history: {}
    });
    scheduleDbMock.assertDemoLifecycleOwnership.mockResolvedValue({
      emailBrand: 'tallykonnect',
      senderAccountKey: 'tallykonnect-google',
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

  it('rejects rows locked to multiple sender accounts in one batch', async () => {
    await expect(
      assertProcessBatchLifecycleOwnership(
        [
          { ...baseRow, id: 'row-1', __emailBrand: 'anywheretally', __senderAccountKey: 'tallykonnect-google' },
          { ...baseRow, id: 'row-2', __emailBrand: 'anywheretally', __senderAccountKey: 'anywheretally-google' }
        ],
        'anywheretally',
        'tallykonnect-google'
      )
    ).rejects.toMatchObject({
      code: 'MIXED_SENDER_ACCOUNT_BATCH',
      statusCode: 409,
      senderAccountKeys: ['tallykonnect-google', 'anywheretally-google']
    });
  });

  it('rejects a lifecycle row when the selected sender does not own the demo', async () => {
    scheduleDbMock.assertDemoLifecycleOwnership.mockRejectedValue(
      new SenderAccountMismatchError('tallykonnect-google', 'anywheretally-google')
    );

    await expect(
      assertProcessBatchLifecycleOwnership(
        [{ ...baseRow, lead_status: 'Demo Done', __emailBrand: 'anywheretally', __senderAccountKey: 'tallykonnect-google' }],
        'anywheretally',
        'anywheretally-google'
      )
    ).rejects.toMatchObject({
      code: 'SENDER_ACCOUNT_MISMATCH',
      statusCode: 409
    });
  });

  it('allows a valid cross-brand/sender lifecycle owner', async () => {
    scheduleDbMock.assertDemoLifecycleOwnership.mockResolvedValue({
      emailBrand: 'anywheretally',
      senderAccountKey: 'tallykonnect-google',
      state: {},
      history: {}
    });

    const result = await assertProcessBatchLifecycleOwnership(
      [{ ...baseRow, lead_status: 'Reschedule', __emailBrand: 'anywheretally', __senderAccountKey: 'tallykonnect-google' }],
      'anywheretally',
      'tallykonnect-google'
    );

    expect(result.lockedBrand).toBe('anywheretally');
    expect(result.lockedSenderAccountKey).toBe('tallykonnect-google');
  });
});
