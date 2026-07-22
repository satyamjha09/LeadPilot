import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { requireMultiSourceAdmin } from './sourceAdminAuth';

function createApp(withOperator = false) {
  const app = express();
  if (withOperator) {
    app.use((req, _res, next) => {
      req.operator = { id: 'operator-1', email: 'admin@example.com', displayName: null, role: 'ADMIN' };
      next();
    });
  }
  app.get('/protected', requireMultiSourceAdmin, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('multi-source admin auth', () => {
  const originalToken = process.env.MULTI_SOURCE_V2_ADMIN_TOKEN;
  const originalLegacy = process.env.ALLOW_LEGACY_ADMIN_TOKENS;

  afterEach(() => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = originalToken;
    process.env.ALLOW_LEGACY_ADMIN_TOKENS = originalLegacy;
  });

  it('allows an authenticated admin operator without browser token headers', async () => {
    delete process.env.ALLOW_LEGACY_ADMIN_TOKENS;
    delete process.env.MULTI_SOURCE_V2_ADMIN_TOKEN;
    await request(createApp(true)).get('/protected').expect(200, { ok: true });
  });

  it('returns 401 when legacy token access is disabled', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';
    process.env.ALLOW_LEGACY_ADMIN_TOKENS = 'false';
    await request(createApp()).get('/protected').set('x-multi-source-admin-token', 'secret').expect(401);
  });

  it('returns 503 when legacy access is enabled but the server token is missing', async () => {
    process.env.ALLOW_LEGACY_ADMIN_TOKENS = 'true';
    delete process.env.MULTI_SOURCE_V2_ADMIN_TOKEN;
    await request(createApp()).get('/protected').expect(503);
  });

  it('returns 401 when the request token is missing', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';
    process.env.ALLOW_LEGACY_ADMIN_TOKENS = 'true';
    await request(createApp()).get('/protected').expect(401);
  });

  it('returns 403 when the request token is wrong', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';
    process.env.ALLOW_LEGACY_ADMIN_TOKENS = 'true';
    await request(createApp()).get('/protected').set('x-multi-source-admin-token', 'wrong').expect(403);
  });

  it('allows legacy requests with the correct token only when enabled', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';
    process.env.ALLOW_LEGACY_ADMIN_TOKENS = 'true';
    await request(createApp()).get('/protected').set('x-multi-source-admin-token', 'secret').expect(200, { ok: true });
  });
});
