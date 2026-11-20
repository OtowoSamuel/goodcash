import { describe, expect, it } from 'vitest';
import { countPartners, decodeCashOut, summarise, type CashOutRow } from './stats';

const word = (n: bigint) => n.toString(16).padStart(64, '0');
const topic = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`;
const WALLET = '0xafdeebb89cda1669361117ea2eae3411f1228cb6';
const USDT = '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e';

describe('decodeCashOut', () => {
  it('reads an original-contract cash out (1,000 G$ for 1.825712 USDT)', () => {
    const row = decodeCashOut(
      {
        transactionHash: '0xabc',
        timeStamp: '0x6aeb7e5e',
        data: `0x${word(1000n * 10n ** 18n)}${word(1825712n)}${word(2n)}${word(1n)}`,
        topics: ['0xfd08', topic(WALLET), topic(WALLET), topic(USDT)],
      },
      'v1',
    );
    expect(row).toMatchObject({ wallet: WALLET, g: 1000, usd: 1.825712, router: 'v1' });
  });

  it('reads a one-tap cash out using the amount paid, not the amount swapped', () => {
    const row = decodeCashOut(
      {
        transactionHash: '0xdef',
        timeStamp: '0x6aeb7e5e',
        data: `0x${word(500n * 10n ** 18n)}${word(900000n)}${word(850000n)}${word(50000n)}${word(0n)}${word(0n)}`,
        topics: ['0xf76a', topic(WALLET), topic(WALLET)],
      },
      'v2',
    );
    expect(row).toMatchObject({ g: 500, usd: 0.85, router: 'v2' });
  });

  it('skips a record it cannot read', () => {
    expect(decodeCashOut({ transactionHash: '0x1', timeStamp: '0x0', data: '0x', topics: [] }, 'v1')).toBeNull();
  });
});

describe('summarise', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const t = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
  const rows: CashOutRow[] = [
    { tx: '0x1', wallet: WALLET, time: t('2026-11-01T10:00:00Z'), g: 1000, usd: 1.8, router: 'v1' },
    { tx: '0x2', wallet: WALLET, time: t('2026-11-10T10:00:00Z'), g: 2000, usd: 3.6, router: 'v2' },
    { tx: '0x3', wallet: '0x1111111111111111111111111111111111111111', time: t('2026-11-11T08:00:00Z'), g: 500, usd: 0.9, router: 'v2' },
  ];

  it('adds up totals, the last 7 days and each contract', () => {
    const s = summarise(rows, now, '0x546698368a246539df5e641edc2b79c5782ea359');
    expect(s.totals).toMatchObject({ cashOuts: 3, wallets: 2, gDollars: 3500, dollars: 6.3 });
    expect(s.last7Days).toMatchObject({ cashOuts: 2, wallets: 2, gDollars: 2500 });
    expect(s.routers.map((r) => r.cashOuts)).toEqual([1, 2]);
  });

  it('gives 90 days ending today, with empty days as zero, and shortens wallets', () => {
    const s = summarise(rows, now, null);
    expect(s.daily).toHaveLength(90);
    expect(s.daily.at(-1)).toMatchObject({ date: '2026-11-11', cashOuts: 1 });
    expect(s.daily.at(-2)).toMatchObject({ date: '2026-11-10', cashOuts: 1, gDollars: 2000 });
    expect(s.daily.at(-3)).toMatchObject({ cashOuts: 0 });
    expect(s.recent[0].wallet).toBe('0x1111…1111');
    expect(JSON.stringify(s)).not.toContain(WALLET);
  });

  it('counts wallets that came back and groups by week starting Monday', () => {
    const s = summarise(rows, now, null);
    expect(s.totals.repeatWallets).toBe(1);
    expect(s.weekly).toHaveLength(12);
    expect(s.weekly.at(-1)).toMatchObject({ date: '2026-11-09', cashOuts: 2, gDollars: 2500 });
    expect(s.weekly.at(-2)).toMatchObject({ date: '2026-11-02', cashOuts: 0 });
    expect(s.weekly.at(-3)).toMatchObject({ date: '2026-10-26', cashOuts: 1 });
  });

  it('copes with no cash outs at all', () => {
    const s = summarise([], now, null);
    expect(s.totals).toMatchObject({ cashOuts: 0, firstAt: null });
    expect(s.recent).toEqual([]);
  });
});

describe('the team\'s own wallets', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const t = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
  const TEAM = '0xafdeebb89cda1669361117ea2eae3411f1228cb6';
  const rows: CashOutRow[] = [
    { tx: '0x1', wallet: TEAM, time: t('2026-11-09T10:00:00Z'), g: 5000, usd: 0.6, router: 'v1' },
    { tx: '0x2', wallet: TEAM, time: t('2026-11-10T10:00:00Z'), g: 6000, usd: 0.7, router: 'v2' },
    { tx: '0x3', wallet: '0x1111111111111111111111111111111111111111', time: t('2026-11-10T11:00:00Z'), g: 1000, usd: 0.11, router: 'v2' },
  ];
  it('are left out of every number and counted openly instead', () => {
    const s = summarise(rows, now, '0x546698368a246539df5e641edc2b79c5782ea359', new Set([TEAM]));
    expect(s.totals).toMatchObject({ cashOuts: 1, wallets: 1, repeatWallets: 0, gDollars: 1000, dollars: 0.11 });
    expect(s.excluded).toEqual({ cashOuts: 2, gDollars: 11000 });
    expect(s.routers.map((r) => r.cashOuts)).toEqual([0, 1]);
    expect(s.weekly.reduce((n, w) => n + w.cashOuts, 0)).toBe(1);
    expect(s.recent).toHaveLength(1);
    expect(JSON.stringify(s)).not.toContain('afdeeb');
  });
  it('count as normal when no list is given', () => {
    const s = summarise(rows, now, null);
    expect(s.totals.cashOuts).toBe(3);
    expect(s.excluded).toEqual({ cashOuts: 0, gDollars: 0 });
  });
});

describe('countPartners', () => {
  const store = (records: Record<string, unknown>) =>
    ({
    async get(k: string) {
      return k in records ? (typeof records[k] === 'string' ? (records[k] as string) : JSON.stringify(records[k])) : null;
    },
    async list(opts: { prefix?: string; limit?: number } = {}) {
      return { keys: Object.keys(records).filter((k) => k.startsWith(opts.prefix ?? '')).slice(0, opts.limit ?? 1000).map((name) => ({ name })), list_complete: true };
    },
  }) as unknown as Pick<KVNamespace, 'get' | 'list'>;

  it('counts switched-on partners, and how many have live keys', async () => {
    const n = await countPartners(
      store({
        'partner:a': { enabled: true },
        'partner:b': { enabled: true, liveApprovedAt: 1 },
        'partner:c': { enabled: false, liveApprovedAt: 1 },
        'partner:d': { enabled: true, selfServe: true },
        'key:xyz': { enabled: true },
      }),
    );
    expect(n).toEqual({ signedUp: 3, live: 1 });
  });
  it('ignores a record it cannot read', async () => {
    expect(await countPartners(store({ 'partner:a': 'not json', 'partner:b': { enabled: true } }))).toEqual({ signedUp: 1, live: 0 });
  });
  it('shows no number rather than a wrong one when there are too many to read one by one', async () => {
    const many = Object.fromEntries(Array.from({ length: 46 }, (_, i) => [`partner:${i}`, { enabled: true }]));
    expect(await countPartners(store(many))).toBeNull();
  });
  it('carries no name, email or site', async () => {
    const n = await countPartners(store({ 'partner:a': { enabled: true, name: 'Secret Co', contactEmail: 'a@b.co', allowedOrigins: ['https://x.example'] } }));
    expect(JSON.stringify(n)).not.toMatch(/Secret|@|example/);
  });
});
