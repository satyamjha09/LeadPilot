import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { requireMultiSourceAdmin } from './sourceAdminAuth';

function createApp() {
  const app = express();
  app.get('/protected', requireMultiSourceAdmin, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('multi-source admin auth', () => {
  const originalToken = process.env.MULTI_SOURCE_V2_ADMIN_TOKEN;

  afterEach(() => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = originalToken;
  });

  it('returns 503 when the server token is missing', async () => {
    delete process.env.MULTI_SOURCE_V2_ADMIN_TOKEN;
    await request(createApp()).get('/protected').expect(503);
  });

  it('returns 401 when the request token is missing', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';
    await request(createApp()).get('/protected').expect(401);
  });

  it('returns 403 when the request token is wrong', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';
    await request(createApp()).get('/protected').set('x-multi-source-admin-token', 'wrong').expect(403);
  });

  it('allows requests with the correct token', async () => {
    process.env.MULTI_SOURCE_V2_ADMIN_TOKEN = 'secret';
    await request(createApp()).get('/protected').set('x-multi-source-admin-token', 'secret').expect(200, { ok: true });
  });
});
