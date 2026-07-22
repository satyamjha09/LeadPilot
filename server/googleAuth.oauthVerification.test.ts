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
  const gmailSend = vi.fn();
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
    gmailSend,
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
          send: googleMock.gmailSend
        }
      }
    }))
  }
}));

const prismaMock = vi.hoisted(() => ({
  googleAuth: {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn()
  },
  googleOAuthState: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn()
  }
}));

vi.mock('./db', () => ({
  prisma: prismaMock
}));

const {
  consumeGoogleOAuthState,
  createGoogleOAuthState,
  exchangeCodeAndSave,
  exchangeCodeAndSaveFromState,
  getAuthStatus,
  GOOGLE_RECONNECT_MESSAGE,
  sendGmailTemplate
} = await import('./googleAuth');

function savedToken(senderAccountKey: 'tallykonnect-google' | 'anywheretally-google', email: string) {
  return {
    id: `auth-${senderAccountKey}`,
    senderAccountKey,
    email,
    connectedEmail: email,
    verifiedAt: new Date(),
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
    prismaMock.googleAuth.update.mockResolvedValue({});
    prismaMock.googleAuth.upsert.mockResolvedValue({});
    prismaMock.googleAuth.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.googleOAuthState.create.mockResolvedValue({});
    prismaMock.googleOAuthState.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.googleOAuthState.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.googleOAuthState.findUnique.mockResolvedValue(null);
    googleMock.gmailSend.mockResolvedValue({
      data: {
        id: 'gmail-message-1',
        threadId: 'gmail-thread-1'
      }
    });
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
        where: { senderAccountKey: 'tallykonnect-google' },
        create: expect.objectContaining({
          senderAccountKey: 'tallykonnect-google',
          email: 'demo.tallykonnect@gmail.com',
          connectedEmail: 'demo.tallykonnect@gmail.com',
          verifiedAt: expect.any(Date)
        })
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
        where: { senderAccountKey: 'anywheretally-google' },
        create: expect.objectContaining({
          senderAccountKey: 'anywheretally-google',
          email: 'info.anywheretally@gmail.com',
          connectedEmail: 'info.anywheretally@gmail.com',
          verifiedAt: expect.any(Date)
        })
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
      if (where.senderAccountKey === 'anywheretally-google') {
        return savedToken('anywheretally-google', 'info.anywheretally@gmail.com');
      }
      if (where.senderAccountKey === 'tallykonnect-google') {
        return savedToken('tallykonnect-google', 'demo.tallykonnect@gmail.com');
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
      where: { senderAccountKey: 'anywheretally-google' }
    });
  });

  it('rejects a mismatched environment refresh token before Gmail side effects', async () => {
    process.env.GOOGLE_TALLYKONNECT_REFRESH_TOKEN = 'wrong-env-refresh';
    googleMock.userinfoGet.mockResolvedValue({
      data: {
        email: 'info.anywheretally@gmail.com'
      }
    });

    await expect(sendGmailTemplate(
      'lead@example.com',
      { subject: 'Hello', text: 'Hello', html: '<p>Hello</p>' },
      'tallykonnect-google'
    )).rejects.toThrow('Gmail email retry failed');

    expect(googleMock.gmailSend).not.toHaveBeenCalled();
    expect(prismaMock.googleAuth.deleteMany).toHaveBeenCalledWith({
      where: { senderAccountKey: 'tallykonnect-google' }
    });
  });

  it('rejects a mismatched persisted token before Gmail side effects', async () => {
    prismaMock.googleAuth.findUnique.mockResolvedValue(
      savedToken('tallykonnect-google', 'demo.tallykonnect@gmail.com')
    );
    googleMock.userinfoGet.mockResolvedValue({
      data: {
        email: 'info.anywheretally@gmail.com'
      }
    });

    await expect(sendGmailTemplate(
      'lead@example.com',
      { subject: 'Hello', text: 'Hello', html: '<p>Hello</p>' },
      'tallykonnect-google'
    )).rejects.toThrow('Gmail email retry failed');

    expect(googleMock.gmailSend).not.toHaveBeenCalled();
    expect(prismaMock.googleAuth.deleteMany).toHaveBeenCalledWith({
      where: { senderAccountKey: 'tallykonnect-google' }
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
        state: expect.any(String),
        login_hint: 'demo.tallykonnect@gmail.com'
      })
    );
  });

  it('stores only a hashed high-entropy OAuth state', async () => {
    const state = await createGoogleOAuthState('tallykonnect-google');
    const createCall = prismaMock.googleOAuthState.create.mock.calls.at(-1)?.[0];

    expect(state).not.toBe('tallykonnect-google');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createCall.data.senderAccountKey).toBe('tallykonnect-google');
    expect(createCall.data.stateHash).not.toBe(state);
    expect(createCall.data.stateHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects expired OAuth state before token exchange', async () => {
    prismaMock.googleOAuthState.findUnique.mockResolvedValue({
      stateHash: 'stored-hash',
      senderAccountKey: 'tallykonnect-google',
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null
    });

    await expect(exchangeCodeAndSaveFromState('secret-code', 'expired-state')).rejects.toMatchObject({
      code: 'INVALID_OAUTH_STATE'
    });

    expect(prismaMock.googleOAuthState.updateMany).not.toHaveBeenCalled();
    expect(googleMock.getToken).not.toHaveBeenCalled();
  });

  it('rejects replayed or concurrently consumed OAuth state', async () => {
    prismaMock.googleOAuthState.findUnique.mockResolvedValue({
      stateHash: 'stored-hash',
      senderAccountKey: 'tallykonnect-google',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null
    });
    prismaMock.googleOAuthState.updateMany.mockResolvedValue({ count: 0 });

    await expect(consumeGoogleOAuthState('already-used-state')).rejects.toMatchObject({
      code: 'INVALID_OAUTH_STATE'
    });

    prismaMock.googleOAuthState.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const attempts = await Promise.allSettled([
      consumeGoogleOAuthState('race-state'),
      consumeGoogleOAuthState('race-state')
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
  });

  it('uses OAuth state ownership instead of caller-provided brand aliases', async () => {
    prismaMock.googleOAuthState.findUnique.mockResolvedValue({
      stateHash: 'stored-hash',
      senderAccountKey: 'anywheretally-google',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null
    });
    prismaMock.googleOAuthState.updateMany.mockResolvedValue({ count: 1 });
    googleMock.userinfoGet.mockResolvedValue({
      data: {
        email: 'info.anywheretally@gmail.com'
      }
    });

    const senderAccountKey = await exchangeCodeAndSaveFromState('code-from-callback', 'state-created-for-awt');

    expect(senderAccountKey).toBe('anywheretally-google');
    expect(prismaMock.googleAuth.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { senderAccountKey: 'anywheretally-google' }
      })
    );
  });
});
