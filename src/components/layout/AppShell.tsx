import { ReactNode, useState } from 'react';
import Header from '@/src/components/layout/Header';
import Sidebar from '@/src/components/layout/Sidebar';
import { DashboardView } from '@/src/lib/rowUtils';
import { AuthStatus, NotificationCounts, SheetSource } from '@/src/types';
import type { OperatorSessionOperator } from '@/src/lib/authClient';
import type { ActiveAccountDefinition, ActiveAccountKey } from '@/src/lib/activeAccount';
import type { SenderAccountKey } from '@/src/lib/senderAccount';

interface AppShellProps {
  children: ReactNode;
  authStatus: AuthStatus | null;
  googleSenderStatuses: Partial<Record<SenderAccountKey, AuthStatus>>;
  operator: OperatorSessionOperator;
  activeAccountKey: ActiveAccountKey;
  activeAccounts: ActiveAccountDefinition[];
  onSelectActiveAccount: (key: ActiveAccountKey) => void;
  onConnectGoogle: (senderAccountKey: SenderAccountKey, mode?: 'CONNECT' | 'RECONNECT') => void;
  onVerifyGoogle: (senderAccountKey: SenderAccountKey) => void;
  onDisconnectGoogle: (senderAccountKey: SenderAccountKey) => void;
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
}

export default function AppShell({
  children,
  authStatus,
  googleSenderStatuses,
  operator,
  activeAccountKey,
  activeAccounts,
  onSelectActiveAccount,
  onConnectGoogle,
  onVerifyGoogle,
  onDisconnectGoogle,
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
  onToggleTheme
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="tk-grid-background flex min-h-screen">
      {!sidebarCollapsed && (
        <Sidebar
          authStatus={authStatus}
          activeView={activeView}
          onNavigate={onNavigate}
          source={source}
          onSyncNow={onSyncNow}
          isSyncing={isSyncing}
          notificationCounts={notificationCounts}
          onCollapse={() => setSidebarCollapsed(true)}
          className="hidden lg:flex"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          authStatus={authStatus}
          googleSenderStatuses={googleSenderStatuses}
          operator={operator}
          activeAccountKey={activeAccountKey}
          activeAccounts={activeAccounts}
          onSelectActiveAccount={onSelectActiveAccount}
          onConnectGoogle={onConnectGoogle}
          onVerifyGoogle={onVerifyGoogle}
          onDisconnectGoogle={onDisconnectGoogle}
          onLogout={onLogout}
          pageTitle={pageTitle}
          pageDescription={pageDescription}
          onRefreshAuth={onRefreshAuth}
          onClearAuth={onClearAuth}
          source={source}
          onSyncNow={onSyncNow}
          isSyncing={isSyncing}
          activeView={activeView}
          onNavigate={onNavigate}
          notificationCounts={notificationCounts}
          isDark={isDark}
          onToggleTheme={onToggleTheme}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        />
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
