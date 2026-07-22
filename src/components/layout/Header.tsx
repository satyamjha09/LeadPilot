import { Bell, CheckCircle2, ChevronDown, FileSpreadsheet, Key, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Sun, UserCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import Sidebar from '@/src/components/layout/Sidebar';
import { DashboardView } from '@/src/lib/rowUtils';
import { AuthStatus, NotificationCounts, SheetSource } from '@/src/types';
import type { OperatorSessionOperator } from '@/src/lib/authClient';
import type { ActiveAccountDefinition, ActiveAccountKey } from '@/src/lib/activeAccount';
import { senderAccountEmail, type SenderAccountKey } from '@/src/lib/senderAccount';

interface HeaderProps {
  authStatus: AuthStatus | null;
  googleSenderStatuses: Partial<Record<SenderAccountKey, AuthStatus>>;
  operator: OperatorSessionOperator;
  activeAccountKey: ActiveAccountKey;
  activeAccounts: ActiveAccountDefinition[];
  onSelectActiveAccount: (key: ActiveAccountKey) => void;
  onConnectGoogle: (senderAccountKey: SenderAccountKey) => void;
  onLogout: () => void | Promise<void>;
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
  googleSenderStatuses,
  operator,
  activeAccountKey,
  activeAccounts,
  onSelectActiveAccount,
  onConnectGoogle,
  onLogout,
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
  const profileInitials = getEmailInitials(operator.email);
  const activeAccount = activeAccounts.find((account) => account.key === activeAccountKey) || activeAccounts[0];
  const activeGoogleStatus = googleSenderStatuses[activeAccount.senderAccountKey] || authStatus;

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
            {!activeGoogleStatus?.authenticated && activeGoogleStatus?.configured ? (
              <div className="flex items-center gap-2">
                {activeGoogleStatus.authError && (
                  <Badge variant="destructive" className="hidden max-w-48 truncate sm:inline-flex" title={activeGoogleStatus.authError}>
                    {activeGoogleStatus.requiresReconnect ? 'Reconnect required' : 'Google auth issue'}
                  </Badge>
                )}
                <Button type="button" size="sm" onClick={() => onConnectGoogle(activeAccount.senderAccountKey)}>
                  <Key className="h-4 w-4" />
                  {activeGoogleStatus.requiresReconnect ? 'Reconnect Google' : 'Connect Google'}
                </Button>
              </div>
            ) : activeGoogleStatus && !activeGoogleStatus.authenticated ? (
              <Badge variant="destructive" className="hidden sm:inline-flex">Configure .env</Badge>
            ) : null}

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="outline" size="sm" className="hidden h-11 min-w-[190px] justify-between rounded-xl md:inline-flex" />
                }
              >
                <span className="min-w-0 text-left">
                  <span className="block truncate text-xs text-muted-foreground">Active Account</span>
                  <span className="block truncate font-semibold">{activeAccount.label}</span>
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel>Business account</DropdownMenuLabel>
                {activeAccounts.map((account) => {
                  const status = googleSenderStatuses[account.senderAccountKey];
                  const connected = !!status?.authenticated;
                  const wrongAccount = connected && status?.connectedEmail && status.connectedEmail !== account.expectedGoogleEmail;
                  const reconnect = !!status?.requiresReconnect || wrongAccount;
                  const statusLabel = reconnect
                    ? wrongAccount
                      ? `Wrong account: ${status?.connectedEmail}`
                      : 'Reconnect required'
                    : connected
                      ? `Connected: ${status?.connectedEmail || account.expectedGoogleEmail}`
                      : !status
                        ? 'Loading'
                        : status.configured === false
                        ? 'Google not configured'
                        : 'Not connected';
                  return (
                    <DropdownMenuItem
                      key={account.key}
                      className="flex-col items-stretch gap-2 p-3"
                      onClick={() => onSelectActiveAccount(account.key)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-semibold">
                            {account.key === activeAccountKey && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                            <span>{account.label}</span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{account.expectedGoogleEmail}</p>
                          <p className="truncate text-xs text-muted-foreground">{statusLabel}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={connected && !reconnect ? 'outline' : 'default'}
                          onClick={(event) => {
                            event.stopPropagation();
                            onConnectGoogle(account.senderAccountKey);
                          }}
                        >
                          {connected && !reconnect ? 'Reconnect' : 'Connect'}
                        </Button>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

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
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 rounded-full pl-2 pr-3"
                    title={operator.email || 'Profile'}
                  />
                }
              >
                <span className={`grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br ${activeAccount.accentClass} text-xs font-bold text-white`}>
                  {profileInitials}
                </span>
                <span className="hidden xl:inline">Profile</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>
                  <div className="flex items-center gap-2">
                    <UserCircle className="h-4 w-4" />
                    <span>Operator</span>
                  </div>
                </DropdownMenuLabel>
                <div className="px-2 py-1 text-sm">
                  <p className="font-semibold">{operator.displayName || operator.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{operator.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Role: {operator.role}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Active: {activeAccount.label}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    Google: {activeGoogleStatus?.authenticated ? activeGoogleStatus.connectedEmail || senderAccountEmail(activeAccount.senderAccountKey) : 'Not connected'}
                  </p>
                </div>
                <DropdownMenuSeparator />
                {authStatus?.authenticated && (
                  <DropdownMenuItem onClick={onClearAuth}>
                    <Key className="h-4 w-4" />
                    Disconnect active Google
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem variant="destructive" onClick={() => void onLogout()}>
                  <LogOut className="h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
      </div>
    </header>
  );
}
