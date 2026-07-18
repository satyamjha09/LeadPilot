import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadpilot-oauth-'));
process.env.DATA_DIR = tempDataDir;

const googleMock = vi.hoisted(() => {
  const getToken = vi.fn();
  const getAccessToken = vi.fn();
  const setCredentials = vi.fn(function setCredentialsMock(this: any, credentials: any) {
    this.credentials = credentials;
  });
  const on = vi.fn();
  const generateAuthUrl = vi.fn(() => 'https://accounts.google.com/mock');
  const revokeCredentials = vi.fn();
  const userinfoGet = vi.fn();
  const oauth2Ctor = vi.fn(function OAuth2Mock(this: any) {
    this.setCredentials = setCredentials;
    this.on = on;
    this.generateAuthUrl = generateAuthUrl;
    this.getToken = getToken;
    this.getAccessToken = getAccessToken;
    this.revokeCredentials = revokeCredentials;
  });

  return {
    getToken,
    getAccessToken,
    setCredentials,
    on,
    generateAuthUrl,
    revokeCredentials,
    userinfoGet,
    oauth2Ctor
  };
});

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: googleMock.oauth2Ctor
    },
    oauth2: vi.fn(() => ({
      userinfo: {
        get: googleMock.userinfoGet
      }
    })),
    gmail: vi.fn(() => ({
      users: {
        messages: {
          send: vi.fn()
        }
      }
    }))
  }
}));

const prismaMock = vi.hoisted(() => ({
  googleAuth: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn()
  }
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const { exchangeCodeAndSave, getAuthStatus, GOOGLE_RECONNECT_MESSAGE } = await import('./googleAuth');

function savedToken(email: string) {
  return {
    email,
    accessToken: `access-${email}`,
    refreshToken: `refresh-${email}`,
    expiryDate: null
  };
}

describe('Google OAuth account verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'tally-client';
    process.env.GOOGLE_CLIENT_SECRET = 'tally-secret';
    process.env.GOOGLE_AUTH_EMAIL = 'demo.tallykonnect@gmail.com';
    process.env.GOOGLE_TALLYKONNECT_AUTH_EMAIL = 'demo.tallykonnect@gmail.com';
    process.env.GMAIL_FROM_EMAIL = 'demo.tallykonnect@gmail.com';
    process.env.GOOGLE_ANYWHERETALLY_CLIENT_ID = 'awt-client';
    process.env.GOOGLE_ANYWHERETALLY_CLIENT_SECRET = 'awt-secret';
    process.env.GOOGLE_ANYWHERETALLY_AUTH_EMAIL = 'info.anywheretally@gmail.com';
    process.env.GMAIL_ANYWHERETALLY_FROM_EMAIL = 'info.anywheretally@gmail.com';
    delete process.env.GOOGLE_REFRESH_TOKEN;
    delete process.env.GOOGLE_TALLYKONNECT_REFRESH_TOKEN;
    delete process.env.GOOGLE_ANYWHERETALLY_REFRESH_TOKEN;

    prismaMock.googleAuth.findUnique.mockResolvedValue(null);
    prismaMock.googleAuth.upsert.mockResolvedValue({});
    prismaMock.googleAuth.deleteMany.mockResolvedValue({ count: 1 });
    googleMock.getToken.mockResolvedValue({
      tokens: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expiry_date: Date.now() + 60_000
      }
    });
    googleMock.getAccessToken.mockResolvedValue({ token: 'validated-access' });
    googleMock.userinfoGet.mockResolvedValue({
      data: {
        email: 'demo.tallykonnect@gmail.com'
      }
    });
  });

  it('accepts the correct TallyKonnect Google account and saves its tokens', async () => {
    await exchangeCodeAndSave('code-tk', 'tallykonnect');

    expect(googleMock.setCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ refresh_token: 'new-refresh' })
    );
    expect(prismaMock.googleAuth.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'demo.tallykonnect@gmail.com' }
      })
    );
    expect(googleMock.revokeCredentials).not.toHaveBeenCalled();
  });

  it('accepts the correct AnyWhereTally Google account and saves its tokens', async () => {
    googleMock.userinfoGet.mockResolvedValue({
      data: {
        email: 'info.anywheretally@gmail.com'
      }
    });

    await exchangeCodeAndSave('code-awt', 'anywheretally');

    expect(prismaMock.googleAuth.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'info.anywheretally@gmail.com' }
      })
    );
    expect(googleMock.revokeCredentials).not.toHaveBeenCalled();
  });

  it('rejects and revokes a wrong Google account before saving tokens', async () => {
    googleMock.userinfoGet.mockResolvedValue({
      data: {
        email: 'info.anywheretally@gmail.com'
      }
    });

    await expect(exchangeCodeAndSave('wrong-code', 'tallykonnect')).rejects.toMatchObject({
      code: 'GOOGLE_ACCOUNT_MISMATCH',
      expectedEmail: 'demo.tallykonnect@gmail.com',
      connectedEmail: 'info.anywheretally@gmail.com'
    });

    expect(prismaMock.googleAuth.upsert).not.toHaveBeenCalled();
    expect(googleMock.revokeCredentials).toHaveBeenCalled();
  });

  it('marks only the invalid_grant brand disconnected while the other brand remains connected', async () => {
    prismaMock.googleAuth.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.email === 'info.anywheretally@gmail.com') {
        return savedToken('info.anywheretally@gmail.com');
      }
      if (where.email === 'demo.tallykonnect@gmail.com') {
        return savedToken('demo.tallykonnect@gmail.com');
      }
      return null;
    });
    googleMock.getAccessToken
      .mockRejectedValueOnce({
        response: {
          data: {
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked'
          }
        }
      })
      .mockResolvedValueOnce({ token: 'valid-tally-token' });
    googleMock.userinfoGet.mockResolvedValueOnce({
      data: {
        email: 'demo.tallykonnect@gmail.com'
      }
    });

    const awtStatus = await getAuthStatus('anywheretally');
    const tallyStatus = await getAuthStatus('tallykonnect');

    expect(awtStatus).toMatchObject({
      brand: 'anywheretally',
      authenticated: false,
      requiresReconnect: true,
      authError: GOOGLE_RECONNECT_MESSAGE
    });
    expect(tallyStatus).toMatchObject({
      brand: 'tallykonnect',
      authenticated: true,
      connectedEmail: 'demo.tallykonnect@gmail.com'
    });
    expect(prismaMock.googleAuth.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.googleAuth.deleteMany).toHaveBeenCalledWith({
      where: { email: 'info.anywheretally@gmail.com' }
    });
  });

  it('includes Google identity scopes in generated auth URLs', async () => {
    await getAuthStatus('tallykonnect');

    expect(googleMock.generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.arrayContaining([
          'openid',
          'https://www.googleapis.com/auth/userinfo.email'
        ]),
        state: 'tallykonnect'
      })
    );
  });
});
