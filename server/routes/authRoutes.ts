import type { Express } from 'express';
import { clearCredentials, exchangeCodeAndSave, getAuthStatus } from '../googleAuth';
import { normalizeEmailBrand } from '../emailTemplates';

export function registerAuthRoutes(app: Express) {
  app.get('/api/auth/status', async (req, res) => {
    try {
      const status = await getAuthStatus(normalizeEmailBrand(req.query.brand));
      return res.json(status);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/clear', async (req, res) => {
    try {
      const brand = normalizeEmailBrand((req.body as any)?.brand || req.query.brand);
      await clearCredentials(brand);
      const status = await getAuthStatus(brand);
      return res.json({ success: true, message: 'Google authentication cleared.', status });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get(['/api/auth/callback/google', '/api/auth/callback/google/'], async (req, res) => {
    try {
      const { code } = req.query;
      if (!code) {
        return res.status(400).send('Missing authorization code.');
      }

      await exchangeCodeAndSave(String(code), normalizeEmailBrand(req.query.brand || req.query.state));

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
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
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
      return res.status(500).send(`Authentication exchange failed: ${err.message}`);
    }
  });
}
