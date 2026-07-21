import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isMultiSourceV2Enabled } from '../multiSourceConfig';
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

  afterEach(() => {
    process.env.MULTI_SOURCE_V2_ENABLED = originalEnabled;
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = originalToken;
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
});
