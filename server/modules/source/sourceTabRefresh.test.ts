import { describe, expect, it } from 'vitest';

import { MISSING_TAB_ERROR, buildInitialTabRows, buildTabRefreshPlan } from './sourceTabRefresh';

describe('source tab refresh', () => {
  it('enables only the preferred tab during initial registration', () => {
    const rows = buildInitialTabRows({
      dataSourceId: 'source1',
      preferredTabId: 'tab2',
      tabs: [
        { externalTabId: 'tab1', name: 'One', position: 0, headersJson: ['a'], headerHash: 'h1' },
        { externalTabId: 'tab2', name: 'Two', position: 1, headersJson: ['b'], headerHash: 'h2' }
      ]
    });

    expect(rows.map((row) => row.isEnabled)).toEqual([false, true]);
  });

  it('matches by externalTabId, preserves enabled state, creates new tabs disabled, and disables missing tabs', () => {
    const plan = buildTabRefreshPlan({
      dataSourceId: 'source1',
      existingTabs: [
        { id: 'db-tab-1', externalTabId: 'stable-1', isEnabled: true },
        { id: 'db-tab-2', externalTabId: 'missing', isEnabled: true }
      ],
      inspectedTabs: [
        { externalTabId: 'stable-1', name: 'Renamed', position: 0, headersJson: ['email'], headerHash: 'new' },
        { externalTabId: 'new-tab', name: 'New', position: 1, headersJson: ['status'], headerHash: 'h' }
      ]
    });

    expect(plan.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'db-tab-1',
          data: expect.objectContaining({ name: 'Renamed', lastError: null })
        }),
        expect.objectContaining({
          id: 'db-tab-2',
          data: { isEnabled: false, lastError: MISSING_TAB_ERROR }
        })
      ])
    );
    expect(plan.creates).toEqual([
      expect.objectContaining({ externalTabId: 'new-tab', isEnabled: false })
    ]);
  });
});
