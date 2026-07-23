import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAuthRoutes } from './authRoutes';

const googleAuthMock = vi.hoisted(() => ({
  clearSenderCredentials: vi.fn(),
  createSenderAuthUrlForOperator: vi.fn(),
  exchangeCodeAndSaveFromState: vi.fn(),
  getGoogleAccountDiagnostics: vi.fn(),
  GOOGLE_OAUTH_MESSAGE_TYPE: 'leadpilot-google-oauth',
  getSenderAuthStatus: vi.fn(),
  listGoogleSenderAccounts: vi.fn()
}));

vi.mock('../googleAuth', () => googleAuthMock);

vi.mock('../operatorAuth/session', () => ({
  resolveOperatorSession: vi.fn(async () => ({
    operator: { id: 'operator-1', email: 'admin@example.com', displayName: null, role: 'ADMIN' },
    sessionId: 'session-1',
    csrfHash: 'csrf-hash'
  }))
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.operator = { id: 'operator-1', email: 'admin@example.com', displayName: null, role: 'ADMIN' };
    req.operatorSession = { id: 'session-1' };
    next();
  });
  registerAuthRoutes(app);
  return app;
}

describe('OAuth callback route hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = 'https://mayakrishnatechnologies.in';
    googleAuthMock.exchangeCodeAndSaveFromState.mockResolvedValue('tallykonnect-google');
  });

  it('posts only safe OAuth status back to the configured app origin', async () => {
    const response = await request(createApp())
      .get('/api/auth/callback/google')
      .query({
        code: 'SECRET_CODE',
        state: 'SECRET_STATE',
        senderAccountKey: 'anywheretally-google'
      })
      .expect(200);

    expect(googleAuthMock.exchangeCodeAndSaveFromState).toHaveBeenCalledWith('SECRET_CODE', 'SECRET_STATE', {
      operatorId: 'operator-1',
      operatorSessionId: 'session-1'
    });
    expect(response.text).toContain('"type":"leadpilot-google-oauth"');
    expect(response.text).toContain('"status":"success"');
    expect(response.text).toContain('"senderAccountKey":"tallykonnect-google"');
    expect(response.text).toContain('https://mayakrishnatechnologies.in');
    expect(response.text).not.toContain("'*'");
    expect(response.text).not.toContain('targetOrigin="*"');
    expect(response.text).not.toContain('SECRET_CODE');
    expect(response.text).not.toContain('SECRET_STATE');
    expect(response.text).not.toContain('anywheretally-google');
  });

  it('renders controlled escaped errors without leaking callback secrets', async () => {
    googleAuthMock.exchangeCodeAndSaveFromState.mockRejectedValue(
      new Error('<script>alert(1)</script> code=SECRET_CODE state=SECRET_STATE refresh-token')
    );

    const response = await request(createApp())
      .get('/api/auth/callback/google')
      .query({ code: 'SECRET_CODE', state: 'SECRET_STATE' })
      .expect(500);

    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.text).toContain('Authentication Exchange Failed');
    expect(response.text).toContain('Google authentication could not be completed. Please try connecting again.');
    expect(response.text).not.toContain('<script>alert(1)</script>');
    expect(response.text).not.toContain('SECRET_CODE');
    expect(response.text).not.toContain('SECRET_STATE');
    expect(response.text).not.toContain('refresh-token');
  });

  it('starts OAuth for the exact sender account with reconnect mode', async () => {
    googleAuthMock.createSenderAuthUrlForOperator.mockResolvedValue('https://accounts.google.com/o/oauth2/v2/auth?safe=1');

    const response = await request(createApp())
      .post('/api/google-senders/anywheretally-google/connect')
      .send({ mode: 'RECONNECT' })
      .expect(200);

    expect(googleAuthMock.createSenderAuthUrlForOperator).toHaveBeenCalledWith(
      'anywheretally-google',
      { operatorId: 'operator-1', operatorSessionId: 'session-1' },
      { mode: 'RECONNECT' }
    );
    expect(response.body).toEqual({
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?safe=1',
      senderAccountKey: 'anywheretally-google',
      mode: 'RECONNECT'
    });
  });

  it('returns both Google account statuses independently', async () => {
    googleAuthMock.listGoogleSenderAccounts.mockResolvedValue([
      { key: 'tallykonnect-google', statusCode: 'CONNECTED', connectedEmail: 'demo.tallykonnect@gmail.com' },
      { key: 'anywheretally-google', statusCode: 'INVALID_GRANT', requiresReconnect: true }
    ]);

    const response = await request(createApp())
      .get('/api/google/accounts/status')
      .expect(200);

    expect(response.body.accounts['tallykonnect-google']).toMatchObject({ statusCode: 'CONNECTED' });
    expect(response.body.accounts['anywheretally-google']).toMatchObject({ statusCode: 'INVALID_GRANT' });
    expect(JSON.stringify(response.body)).not.toMatch(/secret|refresh_token|access_token|authorization_code/i);
  });
});
