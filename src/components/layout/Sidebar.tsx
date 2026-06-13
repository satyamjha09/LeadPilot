import type { ComponentType } from 'react';
import {
  FileSpreadsheet,
  LayoutDashboard,
  List,
  Mail,
  PlayCircle,
  SearchCheck,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { DashboardView } from '@/src/lib/rowUtils';

const navItems: { id: DashboardView; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'leads', label: 'Leads', icon: List },
  { id: 'automations', label: 'Automations', icon: PlayCircle },
  { id: 'manual-review', label: 'Manual Review', icon: SearchCheck },
  { id: 'email-logs', label: 'Email Logs', icon: Mail },
  { id: 'settings', label: 'Settings', icon: Settings }
];

interface SidebarProps {
  activeView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  className?: string;
}

export default function Sidebar({ activeView, onNavigate, className }: SidebarProps) {
  return (
    <aside
      className={cn(
        'flex h-full w-64 flex-col border-r bg-sidebar text-sidebar-foreground',
        className
      )}
    >
      <div className="px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-[0_16px_30px_-20px_rgba(14,165,233,0.9)]">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">TallyKonnect</p>
            <p className="text-xs text-muted-foreground">Scheduler</p>
          </div>
        </div>
        <p className="mt-4 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Demo invites, reminders, thank-you emails, and sheet updates in one workspace.
        </p>
      </div>

      <Separator />

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            type="button"
            variant={activeView === id ? 'secondary' : 'ghost'}
            className={cn(
              'w-full justify-start gap-2',
              activeView === id && 'bg-sidebar-accent text-sidebar-accent-foreground'
            )}
            onClick={() => onNavigate(id)}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Button>
        ))}
      </nav>

      <div className="border-t p-4 text-xs text-muted-foreground">
        Internal team automation
      </div>
    </aside>
  );
}
