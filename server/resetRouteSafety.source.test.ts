import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readLeadRoutes() {
  return fs.readFileSync(path.join(process.cwd(), 'server', 'routes', 'leadRoutes.ts'), 'utf-8');
}

describe('reset route safety source guard', () => {
  it('keeps admin reset token header-only and requires selected-brand confirmation', () => {
    const source = readLeadRoutes();

    expect(source).toContain("req.get('x-admin-reset-token')");
    expect(source).not.toContain('adminResetToken ||');
    expect(source).toContain('INVALID_RESET_CONFIRMATION');
    expect(source).toContain('RESET_${brand.toUpperCase()}');
  });

  it('cancels selected-brand calendar events before generation advance and database deletion', () => {
    const source = readLeadRoutes();
    const resetBody = source.slice(source.indexOf('async function resetDemoDataHandler'));

    expect(resetBody.indexOf('beginWorkflowResetWindow(brand)')).toBeLessThan(
      resetBody.indexOf('prepareProcessQueueForReset(brand)')
    );
    expect(resetBody.indexOf('assertNoActiveResetClaims(brand)')).toBeLessThan(
      resetBody.indexOf('cancelActiveCalendarEventsForReset(brand)')
    );
    expect(resetBody.indexOf('cancelActiveCalendarEventsForReset(brand)')).toBeLessThan(
      resetBody.indexOf('advanceWorkflowGenerationForReset(brand)')
    );
    expect(resetBody.indexOf('advanceWorkflowGenerationForReset(brand)')).toBeLessThan(
      resetBody.indexOf('resetDemoTestData(brand)')
    );
  });
});
