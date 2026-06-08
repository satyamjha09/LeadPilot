import type { ComponentType } from 'react';
import {
  AlertCircle,
  CalendarCheck2,
  Clock3,
  FileSpreadsheet,
  LayoutDashboard,
  List,
  Settings,
  Upload
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { DashboardView } from '@/src/lib/rowUtils';

const navItems: { id: DashboardView; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'import', label: 'Import Sheet', icon: Upload },
  { id: 'all', label: 'All Leads', icon: List },
  { id: 'pending', label: 'Pending', icon: Clock3 },
  { id: 'scheduled', label: 'Scheduled', icon: CalendarCheck2 },
  { id: 'failed', label: 'Failed', icon: AlertCircle },
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
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">Excel Meet Scheduler</p>
          <p className="text-xs text-muted-foreground">Google Automation Tool</p>
        </div>
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
        Google Automation Tool
      </div>
    </aside>
  );
}
