import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isMultiSourceV2Enabled } from '../multiSourceConfig';
import {
  getWorkspaceSourceSnapshot,
  ingestWorkspaceSourceTab,
  ingestWorkspaceSource,
  listWorkspaceCurrentSourceRows,
  listWorkspaceSourceSnapshots,
  prepareSelectedTabProcessing
} from './ingestion/sourceIngestion.service';
import { registerSourceRoutes } from './source.routes';

vi.mock('./source.service', () => ({
  archiveWorkspaceSource: vi.fn(),
  getWorkspaceSource: vi.fn(),
  listWorkspaceSources: vi.fn(async () => []),
  registerExcelSource: vi.fn(),
  registerGoogleSheetsSource: vi.fn(),
  renameWorkspaceSource: vi.fn(),
  setSourceSyncEnabled: vi.fn(),
  setSourceTabEnabled: vi.fn(),
  validateWorkspaceSource: vi.fn()
}));

vi.mock('./ingestion/sourceIngestion.service', () => ({
  getWorkspaceCurrentSourceRow: vi.fn(async () => ({ id: 'row-1', rawData: { headers: [], values: [] } })),
  getWorkspaceSourceSnapshot: vi.fn(async () => ({ id: 'snapshot-1', tabResults: [] })),
  ingestWorkspaceSource: vi.fn(async () => ({ id: 'snapshot-1', status: 'COMPLETED', version: 1 })),
  ingestWorkspaceSourceTab: vi.fn(async () => ({ id: 'snapshot-tab-1', status: 'COMPLETED', version: 2 })),
  listWorkspaceCurrentSourceRows: vi.fn(async () => ({ rows: [], nextCursor: null, limit: 50 })),
  listWorkspaceSourceSnapshots: vi.fn(async () => ({ snapshots: [], nextCursor: null })),
  prepareSelectedTabProcessing: vi.fn(async () => ({
    workspaceKey: 'anywheretally',
    source: { id: 'source-1', type: 'excel', displayName: 'Book.xlsx' },
    tab: { id: 'tab-2', name: 'Sheet 2' },
    snapshot: { id: 'snapshot-tab-1', version: 2, status: 'COMPLETED' },
    rows: [],
    counts: { total: 0 }
  }))
}));

function createApp(registerRoutes: boolean) {
  const app = express();
  app.use(express.json());
  if (registerRoutes) {
    registerSourceRoutes(app);
  }
  return app;
}

describe('source routes and feature flag', () => {
  const originalEnabled = process.env.MULTI_SOURCE_V2_ENABLED;
  const originalToken = process.env.MULTI_SOURCE_V2_ADMIN_TOKEN;
  const originalLegacy = process.env.ALLOW_LEGACY_ADMIN_TOKENS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALLOW_LEGACY_ADMIN_TOKENS = 'true';
  });

  afterEach(() => {
    process.env.MULTI_SOURCE_V2_ENABLED = originalEnabled;
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = originalToken;
    process.env.ALLOW_LEGACY_ADMIN_TOKENS = originalLegacy;
  });

  it('keeps routes hidden when the feature flag is false', async () => {
    process.env.MULTI_SOURCE_V2_ENABLED = 'false';
    expect(isMultiSourceV2Enabled()).toBe(false);

    await request(createApp(isMultiSourceV2Enabled()))
      .get('/api/v2/workspaces/anywheretally/sources')
      .expect(404);
  });

  it('registers routes after the feature flag is enabled and requires the admin token', async () => {
    process.env.MULTI_SOURCE_V2_ENABLED = 'true';
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';
    expect(isMultiSourceV2Enabled()).toBe(true);

    await request(createApp(isMultiSourceV2Enabled()))
      .get('/api/v2/workspaces/anywheretally/sources')
      .set('x-multi-source-admin-token', 'secret')
      .expect(200, { sources: [] });
  });

  it('runs ingestion through the protected route', async () => {
    process.env.MULTI_SOURCE_V2_ENABLED = 'true';
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';

    await request(createApp(true))
      .post('/api/v2/workspaces/anywheretally/sources/source-1/ingest')
      .set('x-multi-source-admin-token', 'secret')
      .expect(200);

    expect(ingestWorkspaceSource).toHaveBeenCalledWith('anywheretally', 'source-1');
  });

  it('runs selected-tab ingestion through the protected route without falling back to all tabs', async () => {
    process.env.MULTI_SOURCE_V2_ENABLED = 'true';
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';

    await request(createApp(true))
      .post('/api/v2/workspaces/anywheretally/sources/source-1/tabs/tab-2/ingest')
      .set('x-multi-source-admin-token', 'secret')
      .expect(200);

    expect(ingestWorkspaceSourceTab).toHaveBeenCalledWith('anywheretally', 'source-1', 'tab-2');
    expect(ingestWorkspaceSource).not.toHaveBeenCalledWith('anywheretally', 'source-1', expect.anything());
  });

  it('prepares processing for exactly the selected source tab', async () => {
    process.env.MULTI_SOURCE_V2_ENABLED = 'true';
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';

    await request(createApp(true))
      .post('/api/v2/workspaces/anywheretally/sources/source-1/tabs/tab-2/prepare-processing')
      .set('x-multi-source-admin-token', 'secret')
      .expect(200);

    expect(prepareSelectedTabProcessing).toHaveBeenCalledWith('anywheretally', 'source-1', 'tab-2');
  });

  it('returns 409 for active ingestion conflicts', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';
    vi.mocked(ingestWorkspaceSource).mockRejectedValueOnce(
      Object.assign(new Error('A source ingestion is already running.'), {
        statusCode: 409,
        code: 'SOURCE_CONFLICT'
      })
    );

    await request(createApp(true))
      .post('/api/v2/workspaces/anywheretally/sources/source-1/ingest')
      .set('x-multi-source-admin-token', 'secret')
      .expect(409);
  });

  it('lists snapshots and snapshot details', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';

    await request(createApp(true))
      .get('/api/v2/workspaces/anywheretally/sources/source-1/snapshots')
      .set('x-multi-source-admin-token', 'secret')
      .expect(200);
    await request(createApp(true))
      .get('/api/v2/workspaces/anywheretally/sources/source-1/snapshots/snapshot-1')
      .set('x-multi-source-admin-token', 'secret')
      .expect(200);

    expect(listWorkspaceSourceSnapshots).toHaveBeenCalled();
    expect(getWorkspaceSourceSnapshot).toHaveBeenCalled();
  });

  it('enforces maximum row-list limit', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';

    await request(createApp(true))
      .get('/api/v2/workspaces/anywheretally/sources/source-1/rows?limit=999')
      .set('x-multi-source-admin-token', 'secret')
      .expect(200);

    expect(listWorkspaceCurrentSourceRows).toHaveBeenCalledWith(
      'anywheretally',
      'source-1',
      expect.objectContaining({ limit: '999' })
    );
  });
});
