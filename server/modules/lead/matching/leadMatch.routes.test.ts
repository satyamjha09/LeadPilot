import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeWorkspaceLeads } from '../merge/leadMerge.service';
import { registerLeadMatchRoutes } from './leadMatch.routes';
import {
  getWorkspaceCanonicalLead,
  getWorkspaceLeadMatchRun,
  listWorkspaceCanonicalLeads,
  listWorkspaceLeadConflicts,
  listWorkspaceLeadMatchRuns,
  previewLeadMatching,
  runLeadMatching,
  updateWorkspaceLeadConflict
} from './leadMatch.service';

vi.mock('../merge/leadMerge.service', () => ({
  mergeWorkspaceLeads: vi.fn(async () => ({ id: 'merge-1' }))
}));

vi.mock('./leadMatch.service', () => ({
  getWorkspaceCanonicalLead: vi.fn(async () => ({ id: 'lead-1' })),
  getWorkspaceLeadMatchRun: vi.fn(async () => ({ id: 'run-1', results: [], conflicts: [] })),
  listWorkspaceCanonicalLeads: vi.fn(async () => ({ leads: [], nextCursor: null })),
  listWorkspaceLeadConflicts: vi.fn(async () => ({ conflicts: [], nextCursor: null })),
  listWorkspaceLeadMatchRuns: vi.fn(async () => ({ runs: [], nextCursor: null })),
  previewLeadMatching: vi.fn(async () => ({
    eligibleRows: 3,
    wouldCreateLeads: 1,
    wouldMatchExisting: 1,
    wouldRemainUnchanged: 0,
    wouldConflict: 1,
    wouldSkip: 0
  })),
  runLeadMatching: vi.fn(async () => ({ id: 'run-1', status: 'COMPLETED', rowCount: 3 })),
  updateWorkspaceLeadConflict: vi.fn(async () => ({ id: 'conflict-1', status: 'RESOLVED' }))
}));

function createApp() {
  const app = express();
  app.use(express.json());
  registerLeadMatchRoutes(app);
  return app;
}

describe('lead match routes', () => {
  const originalToken = process.env.MULTI_SOURCE_V2_ADMIN_TOKEN;
  const originalLegacy = process.env.ALLOW_LEGACY_ADMIN_TOKENS;

  beforeEach(() => {
    process.env.ALLOW_LEGACY_ADMIN_TOKENS = 'true';
  });

  afterEach(() => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = originalToken;
    process.env.ALLOW_LEGACY_ADMIN_TOKENS = originalLegacy;
    vi.clearAllMocks();
  });

  it('requires the multi-source admin token', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';

    await request(createApp())
      .post('/api/v2/workspaces/tallykonnect/sources/source-1/lead-matching/preview')
      .send({ snapshotId: 'snapshot-1' })
      .expect(401);
  });

  it('returns lead-matching preview summary without running writes', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';

    const response = await request(createApp())
      .post('/api/v2/workspaces/tallykonnect/sources/source-1/lead-matching/preview')
      .set('x-multi-source-admin-token', 'secret')
      .send({ snapshotId: 'snapshot-1' })
      .expect(200);

    expect(response.body.summary).toMatchObject({ eligibleRows: 3, wouldCreateLeads: 1 });
    expect(previewLeadMatching).toHaveBeenCalledWith('tallykonnect', 'source-1', 'snapshot-1');
    expect(runLeadMatching).not.toHaveBeenCalled();
  });

  it('runs matching and maps active-run conflicts to 409', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';
    vi.mocked(runLeadMatching).mockRejectedValueOnce(
      Object.assign(new Error('A lead match run is already processing this source.'), {
        statusCode: 409,
        code: 'SOURCE_CONFLICT'
      })
    );

    await request(createApp())
      .post('/api/v2/workspaces/tallykonnect/sources/source-1/lead-matching/run')
      .set('x-multi-source-admin-token', 'secret')
      .send({ snapshotId: 'snapshot-1' })
      .expect(409);

    await request(createApp())
      .post('/api/v2/workspaces/tallykonnect/sources/source-1/lead-matching/run')
      .set('x-multi-source-admin-token', 'secret')
      .send({ snapshotId: 'snapshot-1' })
      .expect(200);
  });

  it('routes run history, conflicts, leads and merge operations', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';
    const app = createApp();
    const token = { 'x-multi-source-admin-token': 'secret' };

    await request(app).get('/api/v2/workspaces/tallykonnect/sources/source-1/lead-matching/runs').set(token).expect(200);
    await request(app)
      .get('/api/v2/workspaces/tallykonnect/sources/source-1/lead-matching/runs/run-1')
      .set(token)
      .expect(200);
    await request(app).get('/api/v2/workspaces/tallykonnect/lead-conflicts?limit=25').set(token).expect(200);
    await request(app)
      .patch('/api/v2/workspaces/tallykonnect/lead-conflicts/conflict-1')
      .set(token)
      .send({ action: 'IGNORE', note: 'Not enough data' })
      .expect(200);
    await request(app).get('/api/v2/workspaces/tallykonnect/leads?limit=25').set(token).expect(200);
    await request(app).get('/api/v2/workspaces/tallykonnect/leads/lead-1').set(token).expect(200);
    await request(app)
      .post('/api/v2/workspaces/tallykonnect/leads/lead-1/merge')
      .set(token)
      .send({ targetLeadId: 'lead-2', note: 'Confirmed duplicate' })
      .expect(200);

    expect(listWorkspaceLeadMatchRuns).toHaveBeenCalled();
    expect(getWorkspaceLeadMatchRun).toHaveBeenCalled();
    expect(listWorkspaceLeadConflicts).toHaveBeenCalled();
    expect(updateWorkspaceLeadConflict).toHaveBeenCalled();
    expect(listWorkspaceCanonicalLeads).toHaveBeenCalled();
    expect(getWorkspaceCanonicalLead).toHaveBeenCalled();
    expect(mergeWorkspaceLeads).toHaveBeenCalled();
  });
});
