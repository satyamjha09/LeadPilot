import {
  findWorkspaceByKey,
  listActiveWorkspaces,
  upsertWorkspace
} from './workspace.repository';
import type { WorkspaceCreateInput } from './workspace.types';

export async function ensureWorkspace(input: WorkspaceCreateInput) {
  return upsertWorkspace(input);
}

export async function getWorkspaceOrThrow(key: string) {
  const workspace = await findWorkspaceByKey(key);
  if (!workspace) {
    throw new Error(`Workspace not found: ${key}`);
  }
  return workspace;
}

export async function listWorkspaces() {
  return listActiveWorkspaces();
}
