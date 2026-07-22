import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../workspace/workspace.service', () => ({
  getWorkspaceOrThrow: vi.fn()
}));

vi.mock('./sourceIngestion.repository', () => ({
  createProcessingSnapshot: vi.fn(),
  failSnapshot: vi.fn(),
  finalizeSnapshot: vi.fn(),
  getCurrentSourceRow: vi.fn(),
  getSourceForIngestion: vi.fn(),
  getSourceSnapshot: vi.fn(),
  listCurrentSourceRows: vi.fn(async () => []),
  listSourceSnapshots: vi.fn(async () => []),
  stageSnapshotRows: vi.fn()
}));

import { getWorkspaceOrThrow } from '../../workspace/workspace.service';
import {
  getSourceForIngestion,
  listCurrentSourceRows,
  listSourceSnapshots
} from './sourceIngestion.repository';
import { listWorkspaceCurrentSourceRows, listWorkspaceSourceSnapshots } from './sourceIngestion.service';

const workspace = { id: 'workspace-1', key: 'tallykonnect', name: 'TallyKonnect' };
const source = {
  id: 'source-1',
  workspaceId: workspace.id,
  type: 'GOOGLE_SHEETS',
  tabs: [],
  archivedAt: null,
  connectionStatus: 'CONNECTED'
};

describe('source ingestion service query isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspaceOrThrow).mockResolvedValue(workspace as any);
    vi.mocked(getSourceForIngestion).mockResolvedValue(source as any);
  });

  it('passes tab and cursor filters through the source-scoped row repository', async () => {
    await listWorkspaceCurrentSourceRows('tallykonnect', 'source-1', {
      tabId: 'tab-1',
      active: 'true',
      validationStatus: 'VALID',
      search: 'rahul',
      cursor: 'row-cursor',
      limit: 999
    });

    expect(getSourceForIngestion).toHaveBeenCalledWith(workspace.id, 'source-1');
    expect(listCurrentSourceRows).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'source-1',
        tabId: 'tab-1',
        active: true,
        validationStatus: 'VALID',
        search: 'rahul',
        cursor: 'row-cursor',
        limit: 200
      })
    );
  });

  it('passes snapshot cursors only after resolving the workspace-owned source', async () => {
    await listWorkspaceSourceSnapshots('tallykonnect', 'source-1', 'snapshot-cursor', 25);

    expect(getSourceForIngestion).toHaveBeenCalledWith(workspace.id, 'source-1');
    expect(listSourceSnapshots).toHaveBeenCalledWith('source-1', 'snapshot-cursor', 25);
  });
});
