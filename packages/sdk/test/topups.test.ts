import { describe, expect, it, vi } from 'vitest';
import { GoodCash, GoodCashError } from '../src';

const PK_TEST = 'gc_pk_test_' + 'a'.repeat(32);
const WALLET = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

const topup = (status: string) => ({ id: 'tu_' + 'a'.repeat(24), object: 'topup', mode: 'test', status, amountNaira: 5000, asset: 'g', wallet: WALLET, partnerRef: null, createdAt: '', updatedAt: '' });
const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

function client(route: (method: string, url: string, body: unknown) => Response | Promise<Response>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', url: String(url), body });
    return route(init?.method ?? 'GET', String(url), body);
  });
  return { gc: new GoodCash({ publishableKey: PK_TEST, fetch: f as unknown as typeof fetch }), calls };
}

describe('top-ups (naira in)', () => {
  it('asks for a quote with the amount, asset and wallet', async () => {
    const { gc, calls } = client(() => ok({ object: 'topup_quote', youGet: { amount: 100, minimum: 99 }, fees: [] }));
    await gc.topUpQuote({ amountNaira: 5000, asset: 'celo', wallet: WALLET });
    expect(calls[0].url).toBe(`https://api.goodcash.xyz/v1/topup/quote?amountNaira=5000&asset=celo&wallet=${WALLET}`);
  });

  it('registers and reads a top-up', async () => {
    const { gc, calls } = client((m) => ok(topup('awaiting_payment'), m === 'POST' ? 201 : 200));
    const t = await gc.createTopUp({ wallet: WALLET, amountNaira: 5000, partnerRef: 'player-1' });
    expect(t.status).toBe('awaiting_payment');
    expect(calls[0]).toMatchObject({ method: 'POST', body: { wallet: WALLET, amountNaira: 5000, partnerRef: 'player-1' } });
    await gc.getTopUp(t.id);
    expect(calls[1].url).toBe(`https://api.goodcash.xyz/v1/topups/${t.id}`);
  });

  it('turns an error from the API into a GoodCashError with its code', async () => {
    const { gc } = client(() => ok({ error: { code: 'topups_not_enabled', message: 'x', detail: 'Contact GoodCash.' } }, 403));
    await expect(gc.topUpQuote({ amountNaira: 5000 })).rejects.toMatchObject({ code: 'topups_not_enabled', status: 403 });
  });

  it('watches until delivered, reporting each change once', async () => {
    const seq = ['awaiting_payment', 'awaiting_payment', 'paid_in', 'paid_in', 'delivered'];
    const { gc } = client(() => ok(topup(seq.shift() ?? 'delivered')));
    const seen: string[] = [];
    const done = await gc.watchTopUp('tu_' + 'a'.repeat(24), (t) => seen.push(t.status), { minIntervalMs: 1, maxIntervalMs: 2 });
    expect(done.status).toBe('delivered');
    expect(seen).toEqual(['awaiting_payment', 'paid_in', 'delivered']);
  });

  it('stops watching a failed top-up, and gives up on a top-up that does not exist', async () => {
    const failed = client(() => ok(topup('failed')));
    expect((await failed.gc.watchTopUp('tu_x', () => undefined, { minIntervalMs: 1 })).status).toBe('failed');
    const missing = client(() => ok({ error: { code: 'not_found', message: 'no' } }, 404));
    await expect(missing.gc.watchTopUp('tu_x', () => undefined, { minIntervalMs: 1 })).rejects.toBeInstanceOf(GoodCashError);
  });

  it('can be stopped', async () => {
    const { gc } = client(() => ok(topup('awaiting_payment')));
    const ctl = new AbortController();
    const p = gc.watchTopUp('tu_x', () => ctl.abort(), { minIntervalMs: 1, signal: ctl.signal });
    await expect(p).rejects.toBeInstanceOf(GoodCashError);
  });
});
