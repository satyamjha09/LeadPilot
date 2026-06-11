import type { Express } from 'express';
import { getReminderConfig, getScheduledReminders, saveReminderConfig } from '../reminders';

export function registerReminderRoutes(app: Express) {
  app.get('/api/reminders/status', (req, res) => {
    try {
      const reminders = getScheduledReminders();
      const config = getReminderConfig();
      return res.json({ reminders, config });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reminders/config', (req, res) => {
    try {
      const { offsetMinutes, enabled } = req.body;
      if (typeof offsetMinutes !== 'number' || typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Config values offsetMinutes (number) and enabled (boolean) are required.' });
      }
      if (![30, 60, 120].includes(offsetMinutes)) {
        return res.status(400).json({ error: 'Reminder timing must be 30, 60, or 120 minutes.' });
      }

      saveReminderConfig({ offsetMinutes, enabled });
      return res.json({ success: true, config: { offsetMinutes, enabled } });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });
}
