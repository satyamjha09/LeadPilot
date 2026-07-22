import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAuthRoutes } from './authRoutes';

const googleAuthMock = vi.hoisted(() => ({
  clearSenderCredentials: vi.fn(),
  createSenderAuthUrlForOperator: vi.fn(),
  exchangeCodeAndSaveFromState: vi.fn(),
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
  registerAuthRoutes(app);
  return app;
}

describe('OAuth callback route hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    googleAuthMock.exchangeCodeAndSaveFromState.mockResolvedValue('tallykonnect-google');
  });

  it('posts only the senderAccountKey back to the opener using the current origin', async () => {
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
    expect(response.text).toContain("type: 'OAUTH_AUTH_SUCCESS'");
    expect(response.text).toContain('senderAccountKey: "tallykonnect-google"');
    expect(response.text).toContain('window.location.origin');
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
});
