import { Bell, ChevronDown, FileSpreadsheet, Key, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import Sidebar from '@/src/components/layout/Sidebar';
import { DashboardView } from '@/src/lib/rowUtils';
import { AuthStatus, NotificationCounts, SheetSource } from '@/src/types';
import type { EmailBrandKey } from '@/src/lib/emailBrand';

interface HeaderProps {
  authStatus: AuthStatus | null;
  emailBrand: EmailBrandKey;
  pageTitle: string;
  pageDescription: string;
  onRefreshAuth: () => void;
  onClearAuth: () => void;
  source: SheetSource;
  onSyncNow?: () => void;
  isSyncing?: boolean;
  activeView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  notificationCounts: NotificationCounts;
  isDark: boolean;
  onToggleTheme: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

function getEmailInitials(email?: string) {
  const localPart = String(email || '').split('@')[0].trim();
  if (!localPart) return 'PR';
  const parts = localPart.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return localPart.slice(0, 2).toUpperCase();
}

export default function Header({
  authStatus,
  emailBrand,
  pageTitle,
  pageDescription,
  onRefreshAuth,
  onClearAuth,
  source,
  onSyncNow,
  isSyncing,
  activeView,
  onNavigate,
  notificationCounts,
  isDark,
  onToggleTheme,
  sidebarCollapsed,
  onToggleSidebar
}: HeaderProps) {
  const manualReviewCount = notificationCounts.manualReview;
  const emailLogsCount = notificationCounts.emailLogs;
  const notificationBadge = manualReviewCount > 99 ? '99+' : String(manualReviewCount);
  const profileEmail = authStatus?.connectedEmail || authStatus?.email || '';
  const profileInitials = getEmailInitials(profileEmail);

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

  const handleNotificationsClick = () => {
    if (manualReviewCount > 0) {
      onNavigate('manual-review');
      return;
    }
    if (emailLogsCount > 0) {
      onNavigate('email-logs');
      return;
    }
    onNavigate('activity');
  };

  return (
    <header className="sticky top-0 z-30 border-b border-sky-200/70 bg-white/78 shadow-sm backdrop-blur-xl dark:border-sky-900/50 dark:bg-slate-950/78">
      <div className="flex min-h-20 items-center justify-between gap-4 px-4 py-3 lg:px-6">
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
                <Sidebar
                  authStatus={authStatus}
                  emailBrand={emailBrand}
                  activeView={activeView}
                  onNavigate={onNavigate}
                  source={source}
                  onSyncNow={onSyncNow}
                  isSyncing={isSyncing}
                  notificationCounts={notificationCounts}
                  className="w-full border-0"
                />
              </SheetContent>
            </Sheet>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
              className="hidden h-11 w-11 rounded-full lg:inline-flex"
              onClick={onToggleSidebar}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-normal">{pageTitle}</h1>
              <p className="truncate text-sm text-muted-foreground">{pageDescription}</p>
            </div>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2">
            {!authStatus?.authenticated && authStatus?.configured ? (
              <div className="flex items-center gap-2">
                {authStatus.authError && (
                  <Badge variant="destructive" className="hidden max-w-48 truncate sm:inline-flex" title={authStatus.authError}>
                    {authStatus.requiresReconnect ? 'Reconnect required' : 'Google auth issue'}
                  </Badge>
                )}
                <Button type="button" size="sm" onClick={handleAuthClick}>
                  <Key className="h-4 w-4" />
                  {authStatus.requiresReconnect ? 'Reconnect Google' : 'Connect Google'}
                </Button>
              </div>
            ) : !authStatus?.authenticated ? (
              <Badge variant="destructive" className="hidden sm:inline-flex">Configure .env</Badge>
            ) : null}

            <div className="hidden min-w-0 max-w-[290px] items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm shadow-sm md:flex">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-sky-600" />
              <div className="min-w-0">
                <p className="truncate text-xs text-muted-foreground">Source</p>
                <p className="truncate font-semibold">
                  {source.type === 'google-sheet' ? source.sheetName : 'Excel import'}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </div>

            {source.type === 'google-sheet' && onSyncNow && (
              <Button type="button" variant="outline" size="sm" onClick={onSyncNow} disabled={isSyncing}>
                <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                Sync
              </Button>
            )}

            <Button type="button" variant="outline" size="icon" className="h-11 w-11 rounded-full" onClick={onRefreshAuth} aria-label="Refresh auth">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" className="h-11 w-11 rounded-full" onClick={onToggleTheme} aria-label="Toggle theme">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="relative h-11 w-11 rounded-full"
              aria-label={manualReviewCount > 0 ? `${manualReviewCount} item${manualReviewCount === 1 ? '' : 's'} need manual review` : 'Open activity'}
              title={manualReviewCount > 0 ? 'Open Manual Review' : emailLogsCount > 0 ? 'Open Email Logs' : 'Open Activity'}
              onClick={handleNotificationsClick}
            >
              <Bell className="h-4 w-4" />
              {manualReviewCount > 0 && (
                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {notificationBadge}
                </span>
              )}
            </Button>
            {authStatus?.authenticated && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 rounded-full pl-2 pr-3"
                onClick={onClearAuth}
                title={profileEmail || 'Profile'}
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-cyan-600 text-xs font-bold text-white">
                  {profileInitials}
                </span>
                <span className="hidden xl:inline">Profile</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                <LogOut className="hidden h-3.5 w-3.5 text-muted-foreground 2xl:block" />
              </Button>
            )}
          </div>
      </div>
    </header>
  );
}
