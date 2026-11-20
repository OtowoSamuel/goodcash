import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchVerified } from './verified';

const answer = (body: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));
afterEach(() => vi.unstubAllGlobals());

describe('fetchVerified', () => {
  it('reads yes and no', async () => {
    answer({ required: true, verified: true });
    expect(await fetchVerified('0xabc')).toBe(true);
    answer({ required: true, verified: false });
    expect(await fetchVerified('0xabc')).toBe(false);
  });
  it('treats a server that does not require it as fine for everyone', async () => {
    answer({ required: false, verified: false });
    expect(await fetchVerified('0xabc')).toBe(true);
  });
  it('an unreadable answer or a failed request is "could not tell", never "not verified"', async () => {
    answer({ data: { sell: { rate: 1500 } } });
    await expect(fetchVerified('0xabc')).rejects.toThrow();
    answer({ error: 'down' }, false);
    await expect(fetchVerified('0xabc')).rejects.toThrow();
  });
});
