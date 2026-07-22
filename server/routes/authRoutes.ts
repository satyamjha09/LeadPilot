import type { Express, Response } from 'express';
import {
  clearSenderCredentials,
  createSenderAuthUrl,
  exchangeCodeAndSaveFromState,
  getSenderAuthStatus,
  listGoogleSenderAccounts
} from '../googleAuth';
import { sendRouteError } from '../routeErrors';
import { parseSenderAccountKey } from '../../src/lib/senderAccount';

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
  input: { senderAccountKey?: string; errorTitle?: string; message?: string; statusCode?: number }
) {
  const success = !!input.senderAccountKey && !input.errorTitle;
  const statusCode = input.statusCode || (success ? 200 : 400);
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
        ${success ? `<script>
          if (window.opener) {
            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', senderAccountKey: ${JSON.stringify(input.senderAccountKey)} }, window.location.origin);
            setTimeout(function() { window.close(); }, 2000);
          } else {
            window.location.href = '/';
          }
        </script>` : ''}
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
  if (error?.code === 'INVALID_OAUTH_STATE') {
    return 'This Google authorization session expired or was already used.';
  }
  return 'Google authentication could not be completed. Please try connecting again.';
}

export function registerAuthRoutes(app: Express) {
  app.get('/api/google-senders', async (_req, res) => {
    try {
      const accounts = await listGoogleSenderAccounts();
      return res.json({ accounts });
    } catch (err: any) {
      return sendRouteError(res, err, 'Google sender list failed');
    }
  });

  app.get('/api/google-senders/:senderAccountKey/status', async (req, res) => {
    try {
      const status = await getSenderAuthStatus(parseSenderAccountKey(req.params.senderAccountKey));
      return res.json(status);
    } catch (err: any) {
      return sendRouteError(res, err, 'Google sender status failed');
    }
  });

  app.get('/api/google-senders/:senderAccountKey/connect', async (req, res) => {
    try {
      const senderAccountKey = parseSenderAccountKey(req.params.senderAccountKey);
      const authUrl = await createSenderAuthUrl(senderAccountKey);
      if (!authUrl) return res.status(503).json({ error: 'Google sender account is not configured.' });
      if (req.query.redirect === 'false') return res.json({ authUrl, senderAccountKey });
      return res.redirect(authUrl);
    } catch (err: any) {
      return sendRouteError(res, err, 'Google sender connect failed');
    }
  });

  app.post('/api/google-senders/:senderAccountKey/disconnect', async (req, res) => {
    try {
      const senderAccountKey = parseSenderAccountKey(req.params.senderAccountKey);
      await clearSenderCredentials(senderAccountKey);
      const status = await getSenderAuthStatus(senderAccountKey);
      return res.json({ success: true, message: 'Google sender account disconnected.', status });
    } catch (err: any) {
      return sendRouteError(res, err, 'Google sender disconnect failed');
    }
  });

  app.get('/api/auth/status', async (req, res) => {
    try {
      const status = await getSenderAuthStatus(parseSenderAccountKey(req.query.senderAccountKey || req.query.brand));
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
          statusCode: 400
        });
      }
      if (!code || !state) {
        return sendOAuthCallbackHtml(res, {
          errorTitle: 'Missing Authorization Code',
          message: 'Google did not return the required authorization data.',
          statusCode: 400
        });
      }

      const senderAccountKey = await exchangeCodeAndSaveFromState(String(code), String(state));

      return sendOAuthCallbackHtml(res, { senderAccountKey });
    } catch (err: any) {
      console.error('Google callback error:', err);
      const statusCode = err?.statusCode || 500;
      return sendOAuthCallbackHtml(res, {
        errorTitle: 'Authentication Exchange Failed',
        message: oauthCallbackErrorMessage(err),
        statusCode
      });
    }
  });
}
