import { describe, expect, it, vi } from 'vitest';
import { seedWorkspaces } from './seed';

describe('multi-source workspace seed', () => {
  it('upserts TallyKonnect and AnyWhereTally idempotently', async () => {
    const client = {
      workspace: {
        upsert: vi.fn().mockResolvedValue({})
      }
    };

    await seedWorkspaces(client as any);
    await seedWorkspaces(client as any);

    expect(client.workspace.upsert).toHaveBeenCalledTimes(4);
    expect(client.workspace.upsert).toHaveBeenNthCalledWith(1, {
      where: { key: 'tallykonnect' },
      update: { name: 'TallyKonnect' },
      create: { key: 'tallykonnect', name: 'TallyKonnect' }
    });
    expect(client.workspace.upsert).toHaveBeenNthCalledWith(2, {
      where: { key: 'anywheretally' },
      update: { name: 'AnyWhereTally' },
      create: { key: 'anywheretally', name: 'AnyWhereTally' }
    });
  });
});
