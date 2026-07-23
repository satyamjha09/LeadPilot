import type { Express, Response } from 'express';
import {
  clearSenderCredentials,
  createSenderAuthUrlForOperator,
  exchangeCodeAndSaveFromState,
  getGoogleAccountDiagnostics,
  GOOGLE_OAUTH_MESSAGE_TYPE,
  getSenderAuthStatus,
  listGoogleSenderAccounts
} from '../googleAuth';
import { sendRouteError } from '../routeErrors';
import { parseSenderAccountKey } from '../../src/lib/senderAccount';
import { resolveOperatorSession } from '../operatorAuth/session';

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendOAuthCallbackHtml(
  res: Response,
  input: { senderAccountKey?: string; errorTitle?: string; message?: string; statusCode?: number; code?: string }
) {
  const success = !!input.senderAccountKey && !input.errorTitle;
  const statusCode = input.statusCode || (success ? 200 : 400);
  const targetOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';
  const message = {
    type: GOOGLE_OAUTH_MESSAGE_TYPE,
    status: success ? 'success' : 'error',
    senderAccountKey: input.senderAccountKey || null,
    code: input.code || (success ? 'CONNECTED' : 'UNKNOWN_GOOGLE_ERROR'),
    message: input.message || (success ? 'LeadPilot has been linked with your Google account.' : 'Google authentication could not be completed.')
  };
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  return res.status(statusCode).send(`
    <html>
      <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #f3f4f6; margin: 0;">
        <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; max-width: 440px;">
          <h2 style="color: ${success ? '#10b981' : '#dc2626'}; margin-top: 0;">${success ? 'Authentication Successful!' : escapeHtml(input.errorTitle || 'Authentication Failed')}</h2>
          <p style="color: #4b5563; margin-bottom: 1.5rem;">${escapeHtml(input.message || (success ? 'LeadPilot has been linked with your Google account.' : 'Google authentication could not be completed.'))}</p>
          <p style="color: #9ca3af; font-size: 0.875rem;">${success ? 'This window will close automatically...' : 'You can close this window and try again.'}</p>
        </div>
        <script>
          if (window.opener) {
            window.opener.postMessage(${JSON.stringify(message)}, ${JSON.stringify(targetOrigin)});
            ${success ? 'setTimeout(function() { window.close(); }, 1200);' : ''}
          } else {
            ${success ? "window.location.href = '/';" : ''}
          }
        </script>
      </body>
    </html>
  `);
}

function oauthCallbackErrorMessage(error: any) {
  if (error?.code === 'GOOGLE_ACCOUNT_MISMATCH') {
    const expected = error.expectedEmail || 'the configured Google sender account';
    const connected = error.connectedEmail || 'a different Google account';
    return `Connected account ${connected} does not match expected account ${expected}.`;
  }
  if (error?.code === 'OAUTH_STATE_EXPIRED') {
    return 'This Google authorization session expired or was already used.';
  }
  if (error?.code === 'OAUTH_STATE_ALREADY_USED') return 'This Google authorization link was already used.';
  if (error?.code === 'OAUTH_SESSION_MISMATCH') return 'This Google authorization was started from a different LeadPilot login session.';
  if (error?.code === 'REFRESH_TOKEN_MISSING') return 'Google did not return offline access. Start Reconnect and approve all requested permissions.';
  return 'Google authentication could not be completed. Please try connecting again.';
}

export function registerAuthRoutes(app: Express) {
  app.get('/api/google-senders', async (_req, res) => {
    try {
      const context = _req.operator && _req.operatorSession
        ? { operatorId: _req.operator.id, operatorSessionId: _req.operatorSession.id }
        : undefined;
      const accounts = await listGoogleSenderAccounts(context);
      return res.json({ accounts });
    } catch (err: any) {
      return sendRouteError(res, err, 'Google sender list failed');
    }
  });

  app.get('/api/google/accounts/status', async (_req, res) => {
    try {
      const accounts = await listGoogleSenderAccounts();
      return res.json({
        accounts: Object.fromEntries(accounts.map((account) => [account.key, account]))
      });
    } catch (err: any) {
      return sendRouteError(res, err, 'Google sender status failed');
    }
  });

  app.get('/api/google-senders/:senderAccountKey/status', async (req, res) => {
    try {
      const context = req.operator && req.operatorSession
        ? { operatorId: req.operator.id, operatorSessionId: req.operatorSession.id }
        : undefined;
      const status = await getSenderAuthStatus(parseSenderAccountKey(req.params.senderAccountKey), context);
      return res.json(status);
    } catch (err: any) {
      return sendRouteError(res, err, 'Google sender status failed');
    }
  });

  app.post('/api/google-senders/:senderAccountKey/connect', async (req, res) => {
    try {
      const senderAccountKey = parseSenderAccountKey(req.params.senderAccountKey);
      if (!req.operator || !req.operatorSession) {
        return res.status(401).json({ error: 'Operator login required.' });
      }
      const mode: 'CONNECT' | 'RECONNECT' =
        String((req.body as any)?.mode || 'CONNECT').toUpperCase() === 'RECONNECT' ? 'RECONNECT' : 'CONNECT';
      const authUrl = await createSenderAuthUrlForOperator(senderAccountKey, {
        operatorId: req.operator.id,
        operatorSessionId: req.operatorSession.id
      }, { mode });
      if (!authUrl) {
        return res.status(503).json({
          error: 'Google sender account is not configured.',
          code: 'NOT_CONFIGURED',
          status: await getGoogleAccountDiagnostics(senderAccountKey)
        });
      }
      return res.json({ authUrl, senderAccountKey, mode });
    } catch (err: any) {
      return sendRouteError(res, err, 'Google sender connect failed');
    }
  });

  app.get('/api/google-senders/:senderAccountKey/connect', async (_req, res) => {
    return res.status(405).json({ error: 'Use POST to start Google OAuth.', code: 'METHOD_NOT_ALLOWED' });
  });

  app.post('/api/google-senders/:senderAccountKey/verify', async (req, res) => {
    try {
      const senderAccountKey = parseSenderAccountKey(req.params.senderAccountKey);
      const status = await getGoogleAccountDiagnostics(senderAccountKey, { verify: true });
      return res.json({ success: status.authenticated, status });
    } catch (err: any) {
      return sendRouteError(res, err, 'Google sender verification failed');
    }
  });

  app.post('/api/google-senders/:senderAccountKey/disconnect', async (req, res) => {
    try {
      const senderAccountKey = parseSenderAccountKey(req.params.senderAccountKey);
      const disconnect = await clearSenderCredentials(senderAccountKey);
      const status = await getSenderAuthStatus(senderAccountKey);
      return res.json({
        success: true,
        message: disconnect.revokeFailed
          ? 'Google sender account disconnected locally. Google token revocation could not be confirmed.'
          : 'Google sender account disconnected.',
        revokeFailed: disconnect.revokeFailed,
        status
      });
    } catch (err: any) {
      return sendRouteError(res, err, 'Google sender disconnect failed');
    }
  });

  app.get('/api/auth/status', async (req, res) => {
    try {
      const context = req.operator && req.operatorSession
        ? { operatorId: req.operator.id, operatorSessionId: req.operatorSession.id }
        : undefined;
      const status = await getSenderAuthStatus(parseSenderAccountKey(req.query.senderAccountKey || req.query.brand), context);
      return res.json(status);
    } catch (err: any) {
      return sendRouteError(res, err, 'Google auth status failed');
    }
  });

  app.post('/api/auth/clear', async (req, res) => {
    try {
      const senderAccountKey = parseSenderAccountKey((req.body as any)?.senderAccountKey || (req.body as any)?.brand || req.query.brand);
      await clearSenderCredentials(senderAccountKey);
      const status = await getSenderAuthStatus(senderAccountKey);
      return res.json({ success: true, message: 'Google authentication cleared.', status });
    } catch (err: any) {
      return sendRouteError(res, err, 'Google authentication clear failed');
    }
  });

  app.get(['/api/auth/callback/google', '/api/auth/callback/google/'], async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) {
        return sendOAuthCallbackHtml(res, {
          errorTitle: 'Authentication Cancelled',
          message: String(error) === 'access_denied'
            ? 'Google access was not approved.'
            : 'Google returned an OAuth error before authorization completed.',
          code: 'GOOGLE_PERMISSION_DENIED',
          statusCode: 400
        });
      }
      if (!code || !state) {
        return sendOAuthCallbackHtml(res, {
          errorTitle: 'Missing Authorization Code',
          message: 'Google did not return the required authorization data.',
          code: 'UNKNOWN_GOOGLE_ERROR',
          statusCode: 400
        });
      }

      const context = await resolveOperatorSession(req);
      if (!context) {
        return sendOAuthCallbackHtml(res, {
          errorTitle: 'Operator Session Required',
          message: 'Your LeadPilot login session expired. Sign in again, then reconnect Google.',
          code: 'OAUTH_SESSION_MISMATCH',
          statusCode: 401
        });
      }

      const senderAccountKey = await exchangeCodeAndSaveFromState(String(code), String(state), {
        operatorId: context.operator.id,
        operatorSessionId: context.sessionId
      });

      return sendOAuthCallbackHtml(res, { senderAccountKey });
    } catch (err: any) {
      console.error('Google callback error:', err);
      const statusCode = err?.statusCode || 500;
      return sendOAuthCallbackHtml(res, {
        errorTitle: 'Authentication Exchange Failed',
        message: oauthCallbackErrorMessage(err),
        code: err?.code || 'UNKNOWN_GOOGLE_ERROR',
        statusCode
      });
    }
  });
}
