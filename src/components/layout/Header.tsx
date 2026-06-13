import { FileSpreadsheet, Key, LogOut, Menu, Moon, RefreshCw, ShieldCheck, Sun, UserCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import Sidebar from '@/src/components/layout/Sidebar';
import { DashboardView } from '@/src/lib/rowUtils';
import { AuthStatus, SheetSource } from '@/src/types';

interface HeaderProps {
  authStatus: AuthStatus | null;
  onRefreshAuth: () => void;
  onClearAuth: () => void;
  source: SheetSource;
  onSyncNow?: () => void;
  isSyncing?: boolean;
  activeView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

export default function Header({
  authStatus,
  onRefreshAuth,
  onClearAuth,
  source,
  onSyncNow,
  isSyncing,
  activeView,
  onNavigate,
  isDark,
  onToggleTheme
}: HeaderProps) {
  const handleAuthClick = () => {
    if (!authStatus?.authUrl) return;
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    const authWindow = window.open(
      authStatus.authUrl,
      'google_oauth_popup',
      `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes`
    );
    if (!authWindow) {
      alert('Pop-up blocked. Please allow pop-ups to connect Google.');
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 shadow-sm backdrop-blur">
      <div className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet>
              <SheetTrigger
                render={
                  <Button variant="outline" size="icon" aria-label="Open menu" className="lg:hidden" />
                }
              >
                  <Menu className="h-4 w-4" />
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <Sidebar activeView={activeView} onNavigate={onNavigate} className="w-full border-0" />
              </SheetContent>
            </Sheet>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">TallyKonnect Scheduler</h1>
              <p className="truncate text-xs text-muted-foreground">Automation workspace</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {authStatus?.authenticated ? (
              <Badge variant="outline" className="hidden gap-1 border-emerald-200 bg-emerald-50 text-emerald-800 sm:inline-flex dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                Google Connected
              </Badge>
            ) : authStatus?.configured ? (
              <Button type="button" size="sm" onClick={handleAuthClick}>
                <Key className="h-4 w-4" />
                Connect Google
              </Button>
            ) : (
              <Badge variant="destructive" className="hidden sm:inline-flex">Configure .env</Badge>
            )}

            <div className="hidden min-w-0 max-w-[260px] items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm md:flex">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-sky-600" />
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {source.type === 'google-sheet' ? source.sheetName : 'Excel import'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {source.type === 'google-sheet' ? 'Current Sheet' : 'Local workbook'}
                </p>
              </div>
            </div>

            {source.type === 'google-sheet' && onSyncNow && (
              <Button type="button" variant="outline" size="sm" onClick={onSyncNow} disabled={isSyncing}>
                <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                Sync
              </Button>
            )}

            <Button type="button" variant="outline" size="icon" onClick={onRefreshAuth} aria-label="Refresh auth">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" onClick={onToggleTheme} aria-label="Toggle theme">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {authStatus?.authenticated && (
              <Button type="button" variant="outline" size="sm" onClick={onClearAuth}>
                <UserCircle2 className="h-4 w-4" />
                <span className="hidden xl:inline">Profile</span>
                <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>
      </div>
    </header>
  );
}
