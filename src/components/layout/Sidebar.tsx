import type { ComponentType } from 'react';
import {
  AlertCircle,
  CalendarCheck2,
  Clock3,
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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-border">
          <img src="/images/logo.png" alt="TallyKonnect" className="h-8 w-8 object-contain" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">TallyKonnect</p>
          <p className="text-xs text-muted-foreground">Smart TDS Scheduler</p>
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
        TallyKonnect Automation
      </div>
    </aside>
  );
}
