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
import { createSheetSyncService } from './server/services/sheetSyncService';
import { isMultiSourceV2Enabled } from './server/modules/multiSourceConfig';
import { registerSourceRoutes } from './server/modules/source/source.routes';

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

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  initReminderJob();
  initEmailRetryJob();
  initSheetSyncRetryJob();

  registerLeadRoutes(app, { runSheetSync: sheetSyncService.runSheetSync });
  registerAuthRoutes(app);
  registerReminderRoutes(app);
  if (isMultiSourceV2Enabled()) {
    registerSourceRoutes(app);
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
