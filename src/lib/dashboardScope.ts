import type { EmailBrandKey } from '@/src/lib/emailBrand';
import type { SenderAccountKey, WorkspaceKey } from '@/src/lib/senderAccount';

export type DashboardRequestScope = {
  workspaceKey: WorkspaceKey;
  emailBrand: EmailBrandKey;
  generation: number;
};

export function dashboardScopeMatches(
  scope: DashboardRequestScope,
  current: {
    workspaceKey: WorkspaceKey;
    emailBrand: EmailBrandKey;
    generation: number;
    senderAccountKey?: SenderAccountKey;
  }
) {
  return (
    scope.workspaceKey === current.workspaceKey &&
    scope.emailBrand === current.emailBrand &&
    scope.generation === current.generation
  );
}
