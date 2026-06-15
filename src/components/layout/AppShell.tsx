import { ReactNode, useState } from 'react';
import Header from '@/src/components/layout/Header';
import Sidebar from '@/src/components/layout/Sidebar';
import { DashboardView } from '@/src/lib/rowUtils';
import { AuthStatus, SheetSource } from '@/src/types';

interface AppShellProps {
  children: ReactNode;
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

export default function AppShell({
  children,
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
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-[linear-gradient(135deg,#f8fbff_0%,#f6f3ff_42%,#eef8ff_100%)] dark:bg-[radial-gradient(circle_at_top_right,#1e1b4b_0,#020617_42%,#0f172a_100%)]">
      {!sidebarCollapsed && (
        <Sidebar
          activeView={activeView}
          onNavigate={onNavigate}
          source={source}
          onSyncNow={onSyncNow}
          isSyncing={isSyncing}
          onCollapse={() => setSidebarCollapsed(true)}
          className="hidden lg:flex"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          authStatus={authStatus}
          onRefreshAuth={onRefreshAuth}
          onClearAuth={onClearAuth}
          source={source}
          onSyncNow={onSyncNow}
          isSyncing={isSyncing}
          activeView={activeView}
          onNavigate={onNavigate}
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
