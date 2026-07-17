import { useEffect, useState } from 'react';
import { Bell, DatabaseZap, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ReminderConfig, ScheduledReminder } from '@/src/types';

const reminderOptions = [
  { label: 'Off', value: 'off', enabled: false, offsetMinutes: 120 },
  { label: '2 hours before', value: '120', enabled: true, offsetMinutes: 120 },
  { label: '1 hour before', value: '60', enabled: true, offsetMinutes: 60 },
  { label: '30 min before', value: '30', enabled: true, offsetMinutes: 30 }
];

export default function SettingsPanel({ onResetComplete }: { onResetComplete?: () => void }) {
  const [config, setConfig] = useState<ReminderConfig>({ offsetMinutes: 120, enabled: false });
  const [reminders, setReminders] = useState<ScheduledReminder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/reminders/status');
      if (!res.ok) throw new Error('Could not load reminder settings.');
      const data = await res.json();
      setConfig(data.config || { offsetMinutes: 120, enabled: false });
      setReminders(data.reminders || []);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load reminders');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const saveConfig = async (updatedConfig: ReminderConfig) => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/reminders/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig)
      });
      if (!res.ok) throw new Error('Could not save reminder setting.');
      const data = await res.json();
      setConfig(data.config);
      toast.success(
        data.config.enabled
          ? `Reminders enabled ${data.config.offsetMinutes} minutes before meetings`
          : 'Reminder emails turned off'
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const activeValue = config.enabled ? String(config.offsetMinutes) : 'off';
  const pendingCount = reminders.filter((r) => r.status === 'Pending' && !r.reminderSent).length;

  const resetDatabase = async () => {
    setIsResetting(true);
    try {
      const res = await fetch('/api/admin/reset-demo-test-data', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not reset database.');
      }
      setReminders([]);
      if (onResetComplete) onResetComplete();
      else toast.success('Demo test data deleted');
      setConfirmResetOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Database reset failed');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="tk-hover-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Reminder emails
          </CardTitle>
          <CardDescription>
            Send one automated reminder email before each scheduled demo meeting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label>Reminder timing</Label>
              <Select
                value={activeValue}
                disabled={isLoading || isSaving}
                onValueChange={(value) => {
                  const option = reminderOptions.find((o) => o.value === value);
                  if (!option) return;
                  saveConfig({ enabled: option.enabled, offsetMinutes: option.offsetMinutes });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select timing" />
                </SelectTrigger>
                <SelectContent>
                  {reminderOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" onClick={loadStatus} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {pendingCount} upcoming reminder(s) queued in the local reminder store.
          </p>
        </CardContent>
      </Card>

      <Card className="tk-hover-card border-destructive/30 bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <DatabaseZap className="h-5 w-5" />
            Reset database
          </CardTitle>
          <CardDescription>
            Delete demo workflow data and clear the current browser workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Clears schedules, email history, sheet state, active demo sessions, demo history, delivery locks, and imported rows on this browser.
          </p>
          <Button type="button" variant="destructive" onClick={() => setConfirmResetOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Reset Data
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all demo data?</DialogTitle>
            <DialogDescription>
              This will permanently delete schedules, email logs, sheet state, active sessions, demo history, and delivery records. It will also clear imported rows from this browser.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmResetOpen(false)} disabled={isResetting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={resetDatabase} disabled={isResetting}>
              {isResetting ? 'Deleting...' : 'Confirm Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
