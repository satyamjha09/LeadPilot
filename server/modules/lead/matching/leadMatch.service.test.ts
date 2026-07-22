import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../workspace/workspace.service', () => ({
  getWorkspaceOrThrow: vi.fn()
}));

vi.mock('./leadMatch.repository', () => ({
  applyLeadMatchPlans: vi.fn(),
  assertSourceTabForLeadMatching: vi.fn(),
  createLeadMatchRun: vi.fn(),
  failLeadMatchRun: vi.fn(),
  getCanonicalLead: vi.fn(),
  getLeadConflict: vi.fn(),
  getLeadMatchRun: vi.fn(),
  getSnapshotForLeadMatching: vi.fn(),
  getSourceForLeadMatching: vi.fn(),
  ignoreLeadConflict: vi.fn(),
  listCanonicalLeads: vi.fn(async () => []),
  listEligibleRowsForSnapshot: vi.fn(async () => []),
  listLeadConflicts: vi.fn(async () => []),
  listLeadMatchRuns: vi.fn(async () => []),
  prefetchIdentityClaims: vi.fn(async () => []),
  resolveLeadConflictLink: vi.fn()
}));

import { SourceNotFoundError } from '../../source/sourceErrors';
import { getWorkspaceOrThrow } from '../../workspace/workspace.service';
import {
  assertSourceTabForLeadMatching,
  getSourceForLeadMatching,
  listCanonicalLeads,
  listLeadConflicts
} from './leadMatch.repository';
import { listWorkspaceCanonicalLeads, listWorkspaceLeadConflicts } from './leadMatch.service';

const workspace = { id: 'workspace-1', key: 'anywheretally', name: 'AnyWhereTally' };
const source = { id: 'source-1', workspaceId: workspace.id, type: 'GOOGLE_SHEETS', tabs: [] };

describe('lead match service query isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspaceOrThrow).mockResolvedValue(workspace as any);
    vi.mocked(getSourceForLeadMatching).mockResolvedValue(source as any);
  });

  it('rejects canonical lead source filters that do not belong to the workspace', async () => {
    vi.mocked(getSourceForLeadMatching).mockRejectedValueOnce(new SourceNotFoundError('Source not found.'));

    await expect(
      listWorkspaceCanonicalLeads('anywheretally', { sourceId: 'foreign-source' })
    ).rejects.toThrow('Source not found');

    expect(listCanonicalLeads).not.toHaveBeenCalled();
  });

  it('validates tab filters against the requested workspace and source before listing leads', async () => {
    await listWorkspaceCanonicalLeads('anywheretally', {
      sourceId: 'source-1',
      tabId: 'tab-1',
      cursor: 'lead-cursor',
      limit: 500
    });

    expect(assertSourceTabForLeadMatching).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      sourceId: 'source-1',
      tabId: 'tab-1'
    });
    expect(listCanonicalLeads).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        sourceId: 'source-1',
        tabId: 'tab-1',
        cursor: 'lead-cursor',
        limit: 200
      })
    );
  });

  it('rejects invalid conflict type filters before listing conflicts', async () => {
    await expect(
      listWorkspaceLeadConflicts('anywheretally', { type: 'OTHER_WORKSPACE_TYPE' })
    ).rejects.toThrow('Invalid lead conflict type filter');

    expect(listLeadConflicts).not.toHaveBeenCalled();
  });
});
