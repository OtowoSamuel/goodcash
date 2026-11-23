import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import worker from './index.js';
import type { Env } from './index.js';
import { fakeLockNamespace } from './lock.fake';
import { buildClaimMessage, VOTE_CHAIN_ID, VOTE_COUNCIL } from './vote';
import { buildTankMessage, giveVoteFee, tankStatus, type TankDeps, type TankEnv } from './voteTank';

// A throwaway key made up for these tests. It has never held anything.
const PERSON_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const person = privateKeyToAccount(PERSON_KEY);
const TANK = '0x00000000000000000000000000000000000000aa';
const ROOT = '0x1111111111111111111111111111111111111111';
const CELO = 10n ** 18n;
const hex = (n: bigint) => `0x${n.toString(16)}`;

async function signed(issuedAt = Date.now(), key = PERSON_KEY, address = person.address) {
  const signature = await privateKeyToAccount(key as `0x${string}`).signMessage({ message: buildTankMessage(address, issuedAt) });
  return { address, issuedAt, signature };
}

function kv() {
  const m = new Map<string, string>();
  return {
    store: m,
    ns: {
      get: async (k: string) => m.get(k) ?? null,
      put: async (k: string, v: string) => void m.set(k, v),
      delete: async (k: string) => void m.delete(k),
    } as unknown as KVNamespace,
  };
}

function setup(opts: { root?: string | null; balances?: Record<string, bigint>; sendFails?: boolean; env?: Partial<TankEnv> } = {}) {
  const k = kv();
  const balances: Record<string, bigint> = { [person.address.toLowerCase()]: 0n, [TANK]: 5n * CELO, ...opts.balances };
  const sends: Array<{ to: string; wei: bigint }> = [];
  const deps: TankDeps = {
    rpc: async (method, params) => {
      if (method === 'eth_getBalance') return hex(balances[String(params[0]).toLowerCase()] ?? 0n);
      if (method === 'eth_call') return `0x${'0'.repeat(24)}${(opts.root === undefined ? ROOT : opts.root ?? '0x' + '0'.repeat(40)).slice(2)}`;
      throw new Error('unexpected');
    },
    tank: {
      address: TANK,
      send: async (to, wei) => {
        if (opts.sendFails) throw new Error('rpc down');
        sends.push({ to, wei });
        balances[to.toLowerCase()] = (balances[to.toLowerCase()] ?? 0n) + wei;
        return `0x${'ab'.repeat(32)}`;
      },
    },
    now: () => Date.UTC(2026, 10, 23, 12),
  };
  const env: TankEnv = { ORDER_STORE: k.ns, VOTE_TANK_ENABLED: 'true', KEY_LOCK: fakeLockNamespace(), ...opts.env };
  return { k, deps, env, sends, balances };
}

describe('buildTankMessage', () => {
  it('is exactly the text the app asks the customer to sign (pinned in apps/web/src/lib/vote.test.ts too)', () => {
    expect(buildTankMessage('0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF', Date.UTC(2026, 10, 23, 12, 0, 0, 789))).toBe(
      ['Ask GoodCash for the small network fee needed to vote.', '', 'Chain: 42220', 'Wallet: 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'Issued at: 2026-11-23T12:00:00Z'].join('\n'),
    );
  });
});

describe('giveVoteFee', () => {
  it('tops a verified wallet up to the target and remembers the person', async () => {
    const s = setup();
    const r = await giveVoteFee(s.env, await signed(), s.deps);
    expect(r).toEqual({ ok: true, status: 'sent', hash: `0x${'ab'.repeat(32)}`, amountCelo: 0.1 });
    expect(s.sends).toEqual([{ to: person.address.toLowerCase(), wei: CELO / 10n }]);
    expect(s.k.store.get(`votetank:${ROOT}`)).toContain('hash');
    expect(s.k.store.get('votetank:day:2026-11-23')).toBe('1');
  });

  it('sends only the shortfall, and nothing at all to a wallet that already has enough', async () => {
    const part = setup({ balances: { [person.address.toLowerCase()]: CELO / 20n } });
    expect(await giveVoteFee(part.env, await signed(), part.deps)).toMatchObject({ ok: true, status: 'sent', amountCelo: 0.05 });
    const full = setup({ balances: { [person.address.toLowerCase()]: CELO / 10n } });
    expect(await giveVoteFee(full.env, await signed(), full.deps)).toEqual({ ok: true, status: 'enough' });
    expect(full.sends).toHaveLength(0);
  });

  it('does nothing unless switched on and given a tank', async () => {
    const s = setup({ env: { VOTE_TANK_ENABLED: 'false' } });
    expect(await giveVoteFee(s.env, await signed(), s.deps)).toEqual({ ok: false, reason: 'off' });
    expect(await giveVoteFee(setup().env, await signed(), null)).toEqual({ ok: false, reason: 'off' });
    expect(s.sends).toHaveLength(0);
  });

  it('refuses a signature made by a different wallet, a garbled one, or one for other text', async () => {
    const s = setup();
    const other = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba';
    expect(await giveVoteFee(s.env, await signed(Date.now(), other), s.deps)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(await giveVoteFee(s.env, { ...(await signed()), signature: `0x${'ab'.repeat(65)}` }, s.deps)).toEqual({ ok: false, reason: 'bad_signature' });
    const wrongText = await person.signMessage({ message: 'Claim voting rights in this Flow Council.' });
    expect(await giveVoteFee(s.env, { address: person.address, issuedAt: Date.now(), signature: wrongText }, s.deps)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(s.sends).toHaveLength(0);
  });

  it('accepts the message a first-time voter already signed to turn on voting, so they sign once', async () => {
    const s = setup();
    const issuedAt = Date.now();
    const signature = await person.signMessage({ message: buildClaimMessage({ chainId: VOTE_CHAIN_ID, councilId: VOTE_COUNCIL, address: person.address, issuedAt }) });
    expect(await giveVoteFee(s.env, { address: person.address, issuedAt, signature, kind: 'claim' }, s.deps)).toMatchObject({ ok: true, status: 'sent' });
    // the same signature does not pass as a fee request, and a fee signature does not pass as a voting one
    const s2 = setup();
    expect(await giveVoteFee(s2.env, { address: person.address, issuedAt, signature }, s2.deps)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(await giveVoteFee(s2.env, { ...(await signed()), kind: 'claim' }, s2.deps)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(s2.sends).toHaveLength(0);
  });

  it('refuses a wallet that is not verified with GoodDollar', async () => {
    const s = setup({ root: null });
    expect(await giveVoteFee(s.env, await signed(), s.deps)).toEqual({ ok: false, reason: 'not_verified' });
    expect(s.sends).toHaveLength(0);
  });

  it('gives one top-up per person, even from another wallet connected to the same person', async () => {
    const s = setup();
    expect((await giveVoteFee(s.env, await signed(), s.deps)).ok).toBe(true);
    s.balances[person.address.toLowerCase()] = 0n;
    expect(await giveVoteFee(s.env, await signed(), s.deps)).toEqual({ ok: false, reason: 'already' });
    expect(s.sends).toHaveLength(1);
  });

  it('stops at the daily cap', async () => {
    const s = setup({ env: { VOTE_TANK_DAILY_CAP: '1' } });
    s.k.store.set('votetank:day:2026-11-23', '1');
    expect(await giveVoteFee(s.env, await signed(), s.deps)).toEqual({ ok: false, reason: 'empty' });
    expect(s.sends).toHaveLength(0);
  });

  it('stops before the tank runs low', async () => {
    const s = setup({ balances: { [TANK]: CELO / 2n } }); // 0.5 CELO: a 0.1 top-up would leave 0.4, above the 0.3 reserve
    expect((await giveVoteFee(s.env, await signed(), s.deps)).ok).toBe(true);
    const low = setup({ balances: { [TANK]: 39n * (CELO / 100n) } }); // 0.39: 0.1 + 0.3 reserve does not fit
    expect(await giveVoteFee(low.env, await signed(), low.deps)).toEqual({ ok: false, reason: 'empty' });
    expect(low.sends).toHaveLength(0);
  });

  it('lets the person try again when the send fails, and does not count it', async () => {
    const s = setup({ sendFails: true });
    expect(await giveVoteFee(s.env, await signed(), s.deps)).toEqual({ ok: false, reason: 'error' });
    expect(s.k.store.size).toBe(0);
  });

  it('answers busy while another top-up is being sent, and pays two requests at the same moment only once', async () => {
    const s = setup();
    const [a, b] = await Promise.all([giveVoteFee(s.env, await signed(), s.deps), giveVoteFee(s.env, await signed(), s.deps)]);
    expect([a, b].filter((r) => r.ok && r.status === 'sent')).toHaveLength(1);
    expect(s.sends).toHaveLength(1);
  });

  it('never puts a key or a signature in what it logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const s = setup({ sendFails: true });
    const input = await signed();
    await giveVoteFee(s.env, input, s.deps);
    expect(JSON.stringify(log.mock.calls)).not.toContain(input.signature);
    log.mockRestore();
  });
});

describe('tankStatus', () => {
  it('answers normal results with 200, a fault with 502, busy with 503, a bad signature with 400', () => {
    expect(tankStatus({ ok: true, status: 'enough' })).toBe(200);
    expect(tankStatus({ ok: false, reason: 'not_verified' })).toBe(200);
    expect(tankStatus({ ok: false, reason: 'error' })).toBe(502);
    expect(tankStatus({ ok: false, reason: 'busy' })).toBe(503);
    expect(tankStatus({ ok: false, reason: 'bad_signature' })).toBe(400);
  });
});

describe('POST /vote/tank', () => {
  const env = { ORDER_STORE: {} as KVNamespace, ALLOWED_ORIGINS: 'https://goodcash.xyz', RATE_LIMIT_MAX: '0' } as unknown as Env;
  const post = (body: unknown) => worker.fetch(new Request('https://api.goodcash.xyz/vote/tank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);

  it('answers "off" until the tank is switched on', async () => {
    const res = await post(await signed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'off' });
  });

  it('refuses a request that is not usable', async () => {
    expect((await post({ address: 'nope', issuedAt: Date.now(), signature: '0x12' })).status).toBe(400);
    const notJson = await worker.fetch(new Request('https://api.goodcash.xyz/vote/tank', { method: 'POST', body: 'not json' }), env);
    expect(notJson.status).toBe(400);
  });
});
