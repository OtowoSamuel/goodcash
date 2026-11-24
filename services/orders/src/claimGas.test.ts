import { describe, expect, it, vi } from 'vitest';
import { askClaimGas, GOODDOLLAR_SERVER } from './claimGas';

const W = '0x2222222222222222222222222222222222222222';
const hex = (n: bigint) => '0x' + n.toString(16);

function deps(opts: { verified?: boolean | null; balanceWei?: bigint; top?: { status?: number; body: unknown } } = {}) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith(GOODDOLLAR_SERVER)) {
      expect(JSON.parse(String(init?.body))).toEqual({ chainId: 42220, account: W });
      return new Response(JSON.stringify(opts.top?.body ?? { ok: 1 }), { status: opts.top?.status ?? 200 });
    }
    return Response.json({ result: hex(opts.balanceWei ?? 0n) });
  });
  return { calls, d: { fetch: f as unknown as typeof fetch, verified: async () => (opts.verified === undefined ? true : opts.verified) } };
}

class KV {
  m = new Map<string, string>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('askClaimGas', () => {
  it('asks GoodDollar at most once a day for one wallet', async () => {
    const kv = new KV();
    const { d, calls } = deps({ balanceWei: 0n });
    expect(await askClaimGas({ ORDER_STORE: kv as never }, W, d)).toEqual({ ok: true, status: 'sent' });
    expect(await askClaimGas({ ORDER_STORE: kv as never }, W, d)).toEqual({ ok: false, reason: 'too_soon' });
    expect(calls.filter((u) => u.startsWith(GOODDOLLAR_SERVER)).length).toBe(1);
  });

  it('asks GoodDollar for a verified wallet with almost no CELO', async () => {
    const { d, calls } = deps({ balanceWei: 10n ** 15n });
    expect(await askClaimGas({}, W.toUpperCase().replace('0X', '0x'), d)).toEqual({ ok: true, status: 'sent' });
    expect(calls.some((u) => u === `${GOODDOLLAR_SERVER}/verify/topWallet`)).toBe(true);
  });

  it('does not ask when the wallet already has enough', async () => {
    const { d, calls } = deps({ balanceWei: 10n ** 17n });
    expect(await askClaimGas({}, W, d)).toEqual({ ok: true, status: 'enough' });
    expect(calls.some((u) => u.startsWith(GOODDOLLAR_SERVER))).toBe(false);
  });

  it('refuses a wallet that is not verified, and a bad address, without asking anyone', async () => {
    const a = deps({ verified: false });
    expect(await askClaimGas({}, W, a.d)).toEqual({ ok: false, reason: 'not_verified' });
    expect(a.calls).toEqual([]);
    expect(await askClaimGas({}, 'nope', a.d)).toEqual({ ok: false, reason: 'bad_wallet' });
  });

  it("reports GoodDollar's refusal, which comes back as HTTP 200 with ok -1", async () => {
    const { d } = deps({ top: { body: { ok: -1, error: 'not whitelisted' } } });
    expect(await askClaimGas({}, W, d)).toEqual({ ok: false, reason: 'refused' });
  });

  it('is off when switched off, and says error when the chain cannot be read', async () => {
    const { d } = deps();
    expect(await askClaimGas({ CLAIM_GAS_ENABLED: 'false' }, W, d)).toEqual({ ok: false, reason: 'off' });
    expect(await askClaimGas({}, W, { ...d, verified: async () => null })).toEqual({ ok: false, reason: 'error' });
  });
});
