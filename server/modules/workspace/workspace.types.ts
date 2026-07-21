import type { WorkspaceStatus } from '@prisma/client';

export type WorkspaceKey = 'tallykonnect' | 'anywheretally' | string;

export type WorkspaceCreateInput = {
  key: WorkspaceKey;
  name: string;
  status?: WorkspaceStatus;
};

export type WorkspaceUpdateInput = {
  name?: string;
  status?: WorkspaceStatus;
};
