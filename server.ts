import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { initReminderJob } from './server/reminders';
import { initEmailRetryJob } from './server/emailRetryWorker';
import { initSheetSyncRetryJob } from './server/sheetSyncWorker';
import { registerAuthRoutes } from './server/routes/authRoutes';
import { registerLeadRoutes } from './server/routes/leadRoutes';
import { registerReminderRoutes } from './server/routes/reminderRoutes';
import { registerOperatorRoutes } from './server/routes/operatorRoutes';
import { createSheetSyncService } from './server/services/sheetSyncService';
import { isMultiSourceV2Enabled } from './server/modules/multiSourceConfig';
import { registerSourceRoutes } from './server/modules/source/source.routes';
import { registerLeadMatchRoutes } from './server/modules/lead/matching/leadMatch.routes';
import { operatorApiBoundary } from './server/operatorAuth/middleware';
import { enforceMutationOrigin } from './server/operatorAuth/origin';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);

async function configureFrontend(app: express.Express) {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
    return;
  }

  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

async function startServer() {
  const app = express();
  const sheetSyncService = createSheetSyncService();
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    next();
  });
  app.use(enforceMutationOrigin);

  initReminderJob();
  initEmailRetryJob();
  initSheetSyncRetryJob();

  registerOperatorRoutes(app);
  app.use('/api', operatorApiBoundary);
  registerLeadRoutes(app, { runSheetSync: sheetSyncService.runSheetSync });
  registerAuthRoutes(app);
  registerReminderRoutes(app);
  if (isMultiSourceV2Enabled()) {
    registerSourceRoutes(app);
    registerLeadMatchRoutes(app);
  }

  await configureFrontend(app);

  app.listen(PORT, '0.0.0.0', () => {
    console.log('-----------------------------------------------');
    console.log(`Excel Meet Scheduler server starts on port ${PORT}`);
    console.log(`Env Redirect URI configured as: ${process.env.GOOGLE_REDIRECT_URI}`);
    console.log('-----------------------------------------------');
  });
}

startServer();
