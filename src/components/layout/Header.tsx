import { Key, LogOut, Menu, Moon, RefreshCw, ShieldCheck, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import Sidebar from '@/src/components/layout/Sidebar';
import { DashboardView } from '@/src/lib/rowUtils';
import { AuthStatus } from '@/src/types';

interface HeaderProps {
  authStatus: AuthStatus | null;
  onRefreshAuth: () => void;
  onClearAuth: () => void;
  activeView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

export default function Header({
  authStatus,
  onRefreshAuth,
  onClearAuth,
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
    <header className="sticky top-0 z-30 border-b border-sky-400/10 bg-[#101113] text-white shadow-[0_18px_45px_-35px_rgba(14,165,233,0.7)]">
      <div className="flex flex-col gap-4 px-4 py-5 lg:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Sheet>
              <SheetTrigger
                render={
                  <Button variant="outline" size="icon" aria-label="Open menu" className="border-white/15 bg-white/5 text-white hover:bg-white/10 lg:hidden" />
                }
              >
                  <Menu className="h-4 w-4" />
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <Sidebar activeView={activeView} onNavigate={onNavigate} className="w-full border-0" />
              </SheetContent>
            </Sheet>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-lg font-extrabold tracking-normal text-white shadow-[0_18px_34px_-22px_rgba(14,165,233,0.95)]">
              TK
            </div>
            <div className="min-w-0">
              <h1 className="bg-gradient-to-r from-sky-300 via-cyan-400 to-blue-500 bg-clip-text text-2xl font-extrabold tracking-normal text-transparent sm:text-4xl">
                TallyKonnect Scheduler
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-300 sm:text-base">
                Manage demo invites, thank-you emails, reminders, and Google Sheet updates
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" size="icon" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={onToggleTheme} aria-label="Toggle theme">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button type="button" variant="outline" size="icon" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={onRefreshAuth} aria-label="Refresh auth">
              <RefreshCw className="h-4 w-4" />
            </Button>

            {authStatus?.authenticated ? (
              <>
                <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Google connected
                </Badge>
                <Button type="button" variant="outline" size="sm" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={onClearAuth}>
                  <LogOut className="h-4 w-4" />
                  Clear Session
                </Button>
              </>
            ) : authStatus?.configured ? (
              <Button type="button" size="sm" onClick={handleAuthClick}>
                <Key className="h-4 w-4" />
                Connect Google
              </Button>
            ) : (
              <Badge variant="destructive">Configure .env credentials</Badge>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
