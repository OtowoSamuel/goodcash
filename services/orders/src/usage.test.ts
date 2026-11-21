import { describe, expect, it } from 'vitest';
import type { CashOutRow } from './stats';
import { listTopUpWallets, parseTopUpWallet, summariseUsage, type TopUpWallet } from './usage';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);
const TEAM = '0x' + 'f'.repeat(40);
const sec = (iso: string) => new Date(iso).getTime() / 1000;
const ms = (iso: string) => new Date(iso).getTime();
const cash = (wallet: string, iso: string): CashOutRow => ({ tx: '0x1', wallet, time: sec(iso), g: 1000, usd: 0.1, router: 'v2' });
const now = new Date('2026-11-21T12:00:00Z'); // a Saturday; the week started Monday 16 Nov

describe('summariseUsage', () => {
  it('counts a wallet once across top-ups and cash outs', () => {
    const u = summariseUsage(
      [cash(A, '2026-11-17T10:00:00Z'), cash(B, '2026-11-18T10:00:00Z')],
      [{ wallet: A, n: 1, first: ms('2026-11-10T10:00:00Z') }, { wallet: C, n: 1, first: ms('2026-11-19T10:00:00Z') }],
      now,
    );
    expect(u).toMatchObject({ wallets: 3, usedBoth: 1, cameBack: 1, topUpCameBack: 0, undated: 0 });
  });

  it('says a wallet came back after two uses in any mix', () => {
    const u = summariseUsage(
      [cash(A, '2026-11-17T10:00:00Z'), cash(A, '2026-11-18T10:00:00Z')],
      [{ wallet: B, n: 2, first: ms('2026-11-10T10:00:00Z') }, { wallet: C, n: 1, first: ms('2026-11-10T10:00:00Z') }],
      now,
    );
    expect(u).toMatchObject({ wallets: 3, cameBack: 2, topUpCameBack: 1, usedBoth: 0 });
  });

  it('puts each wallet in the week of its first use, with 12 weeks ending this week', () => {
    const u = summariseUsage(
      [cash(A, '2026-11-17T10:00:00Z'), cash(B, '2026-11-18T10:00:00Z')],
      [{ wallet: A, n: 1, first: ms('2026-11-10T10:00:00Z') }],
      now,
    );
    expect(u.newWeekly).toHaveLength(12);
    expect(u.newWeekly[11]).toEqual({ date: '2026-11-16', wallets: 1 }); // B
    expect(u.newWeekly[10]).toEqual({ date: '2026-11-09', wallets: 1 }); // A, first seen by its top-up
  });

  it('leaves a wallet with an undated top-up out of the weeks and says how many', () => {
    const u = summariseUsage([cash(A, '2026-11-17T10:00:00Z')], [{ wallet: A, n: 1, first: null }], now);
    expect(u.undated).toBe(1);
    expect(u.newWeekly.reduce((t, w) => t + w.wallets, 0)).toBe(0);
  });

  it('leaves the team\'s own wallets out', () => {
    const u = summariseUsage([cash(TEAM, '2026-11-17T10:00:00Z')], [{ wallet: TEAM, n: 3, first: null }], now, new Set([TEAM]));
    expect(u).toMatchObject({ wallets: 0, cameBack: 0, undated: 0 });
  });
});

describe('top-up wallet markers', () => {
  it('reads old "1" markers and new ones', () => {
    expect(parseTopUpWallet(null)).toBeNull();
    expect(parseTopUpWallet('1')).toEqual({ n: 1, first: null });
    expect(parseTopUpWallet('{"n":3,"first":5}')).toEqual({ n: 3, first: 5 });
  });

  it('lists every page, using metadata and treating missing metadata as one top-up', async () => {
    const pages = [
      { keys: [{ name: `topupwallet:${A}`, metadata: { n: 4, first: 7 } }], list_complete: false, cursor: 'c1' },
      { keys: [{ name: `topupwallet:${B}` }], list_complete: true },
    ];
    const seen: Array<string | undefined> = [];
    const store = { list: async (o: { cursor?: string }) => (seen.push(o.cursor), pages.shift()!) };
    const got: TopUpWallet[] = await listTopUpWallets(store as never);
    expect(got).toEqual([{ wallet: A, n: 4, first: 7 }, { wallet: B, n: 1, first: null }]);
    expect(seen).toEqual([undefined, 'c1']);
  });
});
