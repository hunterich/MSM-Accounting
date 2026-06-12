import { describe, expect, it, vi } from 'vitest';
import { ensureGrIrAccount } from '../grir';

function makeTx(existing: any[] = [], createdId = 'acc-new') {
  const created: any[] = [];
  return {
    organization: { findUnique: vi.fn(async () => ({ accountDefaults: null })) },
    account: {
      findMany: vi.fn(async () => existing),
      findFirst: vi.fn(async () => existing.find(a => a.code === '2150') ?? null),
      create: vi.fn(async ({ data }: any) => { const row = { id: createdId, ...data }; created.push(row); return row; }),
    },
    _created: created,
  };
}

describe('ensureGrIrAccount', () => {
  it('creates a postable LIABILITY account (code 2150) when none exists', async () => {
    const tx = makeTx([]);
    const id = await ensureGrIrAccount(tx as any, 'org-a');
    expect(tx.account.create).toHaveBeenCalled();
    const arg = (tx.account.create as any).mock.calls[0][0].data;
    expect(arg.type).toBe('LIABILITY');
    expect(arg.normalSide).toBe('CREDIT');
    expect(arg.code).toBe('2150');
    expect(arg.isPostable).toBe(true);
    expect(id).toBe('acc-new');
  });

  it('reuses an existing GR/IR account by code instead of creating', async () => {
    const tx = makeTx([{ id: 'acc-existing', code: '2150', name: 'GR/IR', type: 'LIABILITY', isActive: true, isPostable: true }]);
    const id = await ensureGrIrAccount(tx as any, 'org-a');
    expect(tx.account.create).not.toHaveBeenCalled();
    expect(id).toBe('acc-existing');
  });
});
