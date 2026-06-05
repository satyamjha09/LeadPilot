import { ReactNode } from 'react';
import Header from '@/src/components/layout/Header';
import Sidebar from '@/src/components/layout/Sidebar';
import { DashboardView } from '@/src/lib/rowUtils';
import { AuthStatus } from '@/src/types';

interface AppShellProps {
  children: ReactNode;
  authStatus: AuthStatus | null;
  onRefreshAuth: () => void;
  onClearAuth: () => void;
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
  activeView,
  onNavigate,
  isDark,
  onToggleTheme
}: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        activeView={activeView}
        onNavigate={onNavigate}
        className="hidden lg:flex"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          authStatus={authStatus}
          onRefreshAuth={onRefreshAuth}
          onClearAuth={onClearAuth}
          activeView={activeView}
          onNavigate={onNavigate}
          isDark={isDark}
          onToggleTheme={onToggleTheme}
        />
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
