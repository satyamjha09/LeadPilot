import type { Express } from 'express';
import {
  clearSenderCredentials,
  createSenderAuthUrl,
  exchangeCodeAndSaveFromState,
  getSenderAuthStatus,
  listGoogleSenderAccounts
} from '../googleAuth';
import { sendRouteError } from '../routeErrors';
import { parseSenderAccountKey } from '../../src/lib/senderAccount';

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
      const { code, state } = req.query;
      if (!code || !state) {
        return res.status(400).send('Missing authorization code.');
      }

      const senderAccountKey = await exchangeCodeAndSaveFromState(String(code), String(state));

      return res.send(`
        <html>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #f3f4f6; margin: 0;">
            <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center;">
              <h2 style="color: #10b981; margin-top: 0;">Authentication Successful!</h2>
              <p style="color: #4b5563; margin-bottom: 1.5rem;">Excel Meet Scheduler has been linked with your Google Workspace credentials.</p>
              <p style="color: #9ca3af; font-size: 0.875rem;">This window will close automatically...</p>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', senderAccountKey: ${JSON.stringify(senderAccountKey)} }, window.location.origin);
                setTimeout(function() { window.close(); }, 2000);
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error('Google callback error:', err);
      const statusCode = err?.statusCode || 500;
      return res.status(statusCode).send(`Authentication exchange failed: ${err.message}`);
    }
  });
}
