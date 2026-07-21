import { prisma } from '../../db';
import type { WorkspaceCreateInput, WorkspaceUpdateInput } from './workspace.types';

export async function findWorkspaceByKey(key: string) {
  return prisma.workspace.findUnique({ where: { key } });
}

export async function listActiveWorkspaces() {
  return prisma.workspace.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' }
  });
}

export async function createWorkspace(input: WorkspaceCreateInput) {
  return prisma.workspace.create({
    data: {
      key: input.key,
      name: input.name,
      status: input.status || 'ACTIVE'
    }
  });
}

export async function updateWorkspace(key: string, input: WorkspaceUpdateInput) {
  return prisma.workspace.update({
    where: { key },
    data: input
  });
}

export async function upsertWorkspace(input: WorkspaceCreateInput) {
  return prisma.workspace.upsert({
    where: { key: input.key },
    update: {
      name: input.name,
      ...(input.status ? { status: input.status } : {})
    },
    create: {
      key: input.key,
      name: input.name,
      status: input.status || 'ACTIVE'
    }
  });
}
