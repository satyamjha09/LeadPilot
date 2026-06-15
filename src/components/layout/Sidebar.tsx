import type { ComponentType } from 'react';
import {
  ChevronDown,
  FileSpreadsheet,
  LayoutDashboard,
  List,
  Mail,
  PanelLeftClose,
  PlayCircle,
  RefreshCw,
  Rocket,
  SearchCheck,
  Settings,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { DashboardView } from '@/src/lib/rowUtils';
import type { SheetSource } from '@/src/types';

const navItems: { id: DashboardView; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'leads', label: 'Leads', icon: List },
  { id: 'manual-review', label: 'Manual Review', icon: SearchCheck },
  { id: 'email-logs', label: 'Email Logs', icon: Mail },
  { id: 'automations', label: 'Automations', icon: PlayCircle },
  { id: 'settings', label: 'Settings', icon: Settings }
];

interface SidebarProps {
  activeView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  source: SheetSource;
  onSyncNow?: () => void;
  isSyncing?: boolean;
  onCollapse?: () => void;
  className?: string;
}

export default function Sidebar({ activeView, onNavigate, source, onSyncNow, isSyncing, onCollapse, className }: SidebarProps) {
  const isGoogleSheet = source.type === 'google-sheet';
  const sourceName = isGoogleSheet ? source.sheetName || 'TallyKonnect Leads' : 'Excel import';

  return (
    <aside
      className={cn('flex h-full w-64 flex-col border-r border-white/10 bg-[radial-gradient(circle_at_top_left,#312e81_0,#0f172a_42%,#020617_100%)] text-white', className)}
    >
      <div className="px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 to-indigo-600 text-white shadow-[0_18px_35px_-18px_rgba(124,58,237,0.95)]">
            <Rocket className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold leading-tight">TallyKonnect</p>
            <p className="text-xs text-slate-400">Automation Workspace</p>
          </div>
          {onCollapse && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close sidebar"
              className="hidden h-8 w-8 shrink-0 rounded-lg text-slate-400 hover:bg-white/10 hover:text-white lg:inline-flex"
              onClick={onCollapse}
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
          Demo invites, reminders, thank-you emails, and sheet updates in one workspace.
        </p>
      </div>

      <Separator className="bg-white/10" />

      <nav className="flex-1 space-y-5 p-3">
        <NavGroup title="Main" items={navItems.slice(0, 1)} activeView={activeView} onNavigate={onNavigate} />
        <NavGroup title="Workspace" items={navItems.slice(1, 4)} activeView={activeView} onNavigate={onNavigate} />
        <NavGroup title="Automation" items={navItems.slice(4, 5)} activeView={activeView} onNavigate={onNavigate} />
        <NavGroup title="System" items={navItems.slice(5)} activeView={activeView} onNavigate={onNavigate} />
      </nav>

      <div className="space-y-3 border-t border-white/10 p-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500 text-white">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{isGoogleSheet ? 'Google Sheet' : 'Local Sheet'}</p>
              <p className="truncate text-xs text-slate-400">{sourceName}</p>
              <p className="text-xs text-slate-500">{isGoogleSheet ? 'Ready to sync' : 'Upload mode'}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 w-full border-white/15 bg-transparent text-white hover:bg-white/10 disabled:opacity-50"
            disabled={!isGoogleSheet || !onSyncNow || isSyncing}
            onClick={onSyncNow}
          >
            <RefreshCw className={cn('h-4 w-4', isSyncing && 'animate-spin')} />
            {isSyncing ? 'Syncing' : 'Sync Now'}
          </Button>
        </div>
        <div className="flex items-center gap-3 rounded-2xl p-2 hover:bg-white/5">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-200 text-slate-700">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">Satyam Jha</p>
            <p className="text-xs text-slate-400">Admin</p>
          </div>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </div>
      </div>
    </aside>
  );
}

function NavGroup({
  title,
  items,
  activeView,
  onNavigate
}: {
  title: string;
  items: typeof navItems;
  activeView: DashboardView;
  onNavigate: (view: DashboardView) => void;
}) {
  return (
    <div>
      <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="space-y-1">
        {items.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            type="button"
            variant="ghost"
            className={cn(
              'h-10 w-full justify-start gap-3 rounded-xl text-slate-300 hover:bg-white/10 hover:text-white',
              activeView === id && 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-violet-900/30'
            )}
            onClick={() => onNavigate(id)}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1 text-left">{label}</span>
            {label === 'Manual Review' && <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-xs">5</span>}
            {label === 'Email Logs' && <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-xs">12</span>}
          </Button>
        ))}
      </div>
    </div>
  );
}
