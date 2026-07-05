import { describe, expect, it, vi } from 'vitest';
import { probeOnline } from '../connectivity';

describe('probeOnline', () => {
  it('returns true when the ping resolves ok', async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    expect(await probeOnline(ping)).toBe(true);
  });
  it('returns false when the ping throws', async () => {
    const ping = vi.fn().mockRejectedValue(new Error('network'));
    expect(await probeOnline(ping)).toBe(false);
  });
});
