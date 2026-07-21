import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';

type WorkspaceSeedClient = Pick<PrismaClient, 'workspace'>;

const WORKSPACE_SEEDS = [
  { key: 'tallykonnect', name: 'TallyKonnect' },
  { key: 'anywheretally', name: 'AnyWhereTally' }
] as const;

export async function seedWorkspaces(prisma: WorkspaceSeedClient) {
  for (const workspace of WORKSPACE_SEEDS) {
    await prisma.workspace.upsert({
      where: { key: workspace.key },
      update: { name: workspace.name },
      create: {
        key: workspace.key,
        name: workspace.name
      }
    });
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedWorkspaces(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
