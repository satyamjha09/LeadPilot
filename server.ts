import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { initReminderJob } from './server/reminders';
import { registerAuthRoutes } from './server/routes/authRoutes';
import { registerLeadRoutes } from './server/routes/leadRoutes';
import { registerReminderRoutes } from './server/routes/reminderRoutes';
import { createSheetSyncService } from './server/services/sheetSyncService';

dotenv.config();

const PORT = 3000;

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

  registerLeadRoutes(app, { runSheetSync: sheetSyncService.runSheetSync });
  registerAuthRoutes(app);
  registerReminderRoutes(app);

  await configureFrontend(app);

  app.listen(PORT, '0.0.0.0', () => {
    console.log('-----------------------------------------------');
    console.log(`Excel Meet Scheduler server starts on port ${PORT}`);
    console.log(`Env Redirect URI configured as: ${process.env.GOOGLE_REDIRECT_URI}`);
    console.log('-----------------------------------------------');
  });
}

startServer();
