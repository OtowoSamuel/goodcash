/**
 * Public numbers for the stats page (GET /stats).
 *
 * Everything here comes from the chain, the same cash-out records anyone can read on the block explorer: no
 * customer, bank or order data is touched, and wallets are shortened. The indexer's log list is read at most once
 * every 10 minutes (edge cache). The last good answer is kept in one KV value, written only when the numbers
 * change, so an indexer hiccup serves the previous numbers instead of an error.
 */

export interface StatsEnv {
  ORDER_STORE: KVNamespace;
  BLOCKSCOUT_URL?: string;
  ROUTER_ADDRESS?: string;
  ROUTER_V2_ADDRESS?: string;
  ROUTER_V2_DEPLOY_BLOCK?: string;
}

const V1_ROUTER = '0xa4338586d4b2f0e1641c54b8cf0d53cd06b5c407';
const V1_DEPLOY_BLOCK = 81917173;
const V1_TOPIC = '0xfd08ba0cf09cbb75e5d99933b03678a9b307c9a4839063749004850da25931dc';
const V2_TOPIC = '0xf76a7b57d20e27c73ccada71d551173e9a82e46372f8dedf840cb08ad5ea60d7';
const USDT = '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e';

const CACHE_SECONDS = 600;
const SNAPSHOT_KEY = 'stats:snapshot';
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
const DAYS_SHOWN = 90;
const RECENT_SHOWN = 10;

interface ExplorerLog {
  transactionHash: string;
  data: string;
  timeStamp: string;
  topics: string[];
}

export interface CashOutRow {
  tx: string;
  wallet: string;
  /** Unix seconds */
  time: number;
  /** G$ cashed out */
  g: number;
  /** Dollars the cash out produced */
  usd: number;
  router: 'v1' | 'v2';
}

export interface Stats {
  updatedAt: string;
  totals: { cashOuts: number; wallets: number; gDollars: number; dollars: number; firstAt: string | null; lastAt: string | null };
  last7Days: { cashOuts: number; wallets: number; gDollars: number; dollars: number };
  routers: Array<{ name: string; address: string; cashOuts: number; gDollars: number }>;
  daily: Array<{ date: string; cashOuts: number; gDollars: number; dollars: number }>;
  recent: Array<{ wallet: string; time: string; gDollars: number; dollars: number; tx: string }>;
}

function words(data: string): bigint[] {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  const out: bigint[] = [];
  for (let i = 0; i + 64 <= hex.length; i += 64) out.push(BigInt(`0x${hex.slice(i, i + 64)}`));
  return out;
}

/** Whole units of an 18-decimal or 6-decimal amount, as a plain number (fine for display). */
function units(value: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  return Number(value / base) + Number(value % base) / Number(base);
}

function topicAddress(topic: string | undefined): string {
  return topic && topic.length >= 42 ? `0x${topic.slice(-40)}`.toLowerCase() : '';
}

export function decodeCashOut(log: ExplorerLog, router: 'v1' | 'v2'): CashOutRow | null {
  const w = words(log.data);
  const time = Number(BigInt(log.timeStamp || '0x0'));
  const wallet = topicAddress(log.topics?.[1]);
  if (!wallet || !time) return null;
  if (router === 'v1') {
    // data: amountIn, amountOut, route, ref · topics: user, recipient, tokenOut
    if (w.length < 2) return null;
    const tokenOut = topicAddress(log.topics?.[3]);
    return { tx: log.transactionHash, wallet, time, g: units(w[0], 18), usd: units(w[1], tokenOut === USDT ? 6 : 18), router };
  }
  // data: gIn, usdtOut, usdtPaid, usdtReturned, route, ref · topics: user, payTo
  if (w.length < 3) return null;
  return { tx: log.transactionHash, wallet, time, g: units(w[0], 18), usd: units(w[2], 6), router };
}

async function fetchLogs(env: StatsEnv, address: string, topic0: string, fromBlock: number): Promise<ExplorerLog[]> {
  const base = env.BLOCKSCOUT_URL || 'https://celo.blockscout.com';
  const all: ExplorerLog[] = [];
  let from = fromBlock;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(
      `${base}/api?module=logs&action=getLogs&fromBlock=${from}&toBlock=latest&address=${address}&topic0=${topic0}`,
    );
    if (!res.ok) throw new Error(`explorer ${res.status}`);
    const body = (await res.json()) as { result?: Array<ExplorerLog & { blockNumber: string }>; message?: string };
    if (!Array.isArray(body.result)) {
      if (body.message && /no logs/i.test(body.message)) break;
      throw new Error(`explorer: ${body.message ?? 'bad answer'}`);
    }
    all.push(...body.result);
    if (body.result.length < PAGE_SIZE) break;
    from = parseInt(body.result[body.result.length - 1].blockNumber, 16) + 1;
  }
  return all;
}

const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const shorten = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function summarise(rows: CashOutRow[], now: Date, v2Address: string | null): Stats {
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  const sum = (list: CashOutRow[]) => ({
    cashOuts: list.length,
    wallets: new Set(list.map((r) => r.wallet)).size,
    gDollars: round(list.reduce((s, r) => s + r.g, 0), 0),
    dollars: round(list.reduce((s, r) => s + r.usd, 0)),
  });
  const weekAgo = now.getTime() / 1000 - 7 * 86400;

  const byDay = new Map<string, { cashOuts: number; gDollars: number; dollars: number }>();
  for (const r of sorted) {
    const d = byDay.get(day(r.time)) ?? { cashOuts: 0, gDollars: 0, dollars: 0 };
    d.cashOuts++;
    d.gDollars += r.g;
    d.dollars += r.usd;
    byDay.set(day(r.time), d);
  }
  const daily: Stats['daily'] = [];
  for (let i = DAYS_SHOWN - 1; i >= 0; i--) {
    const date = day(now.getTime() / 1000 - i * 86400);
    const d = byDay.get(date);
    daily.push({ date, cashOuts: d?.cashOuts ?? 0, gDollars: round(d?.gDollars ?? 0, 0), dollars: round(d?.dollars ?? 0) });
  }

  const v1 = sorted.filter((r) => r.router === 'v1');
  const v2 = sorted.filter((r) => r.router === 'v2');
  return {
    updatedAt: now.toISOString(),
    totals: {
      ...sum(sorted),
      firstAt: sorted.length ? new Date(sorted[0].time * 1000).toISOString() : null,
      lastAt: sorted.length ? new Date(sorted[sorted.length - 1].time * 1000).toISOString() : null,
    },
    last7Days: sum(sorted.filter((r) => r.time >= weekAgo)),
    routers: [
      { name: 'Original contract', address: V1_ROUTER, cashOuts: v1.length, gDollars: round(sum(v1).gDollars, 0) },
      ...(v2Address ? [{ name: 'One-tap contract', address: v2Address, cashOuts: v2.length, gDollars: round(sum(v2).gDollars, 0) }] : []),
    ],
    daily,
    recent: sorted
      .slice(-RECENT_SHOWN)
      .reverse()
      .map((r) => ({ wallet: shorten(r.wallet), time: new Date(r.time * 1000).toISOString(), gDollars: round(r.g, 0), dollars: round(r.usd), tx: r.tx })),
  };
}

export async function buildStats(env: StatsEnv, now = new Date()): Promise<Stats> {
  const v1 = (env.ROUTER_ADDRESS || V1_ROUTER).toLowerCase();
  const v2 = env.ROUTER_V2_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(env.ROUTER_V2_ADDRESS) ? env.ROUTER_V2_ADDRESS.toLowerCase() : null;
  const v2Block = Number(env.ROUTER_V2_DEPLOY_BLOCK) > 0 ? Number(env.ROUTER_V2_DEPLOY_BLOCK) : V1_DEPLOY_BLOCK;

  const [logs1, logs2] = await Promise.all([
    fetchLogs(env, v1, V1_TOPIC, V1_DEPLOY_BLOCK),
    v2 ? fetchLogs(env, v2, V2_TOPIC, v2Block) : Promise.resolve([] as ExplorerLog[]),
  ]);
  const rows = [
    ...logs1.map((l) => decodeCashOut(l, 'v1')),
    ...logs2.map((l) => decodeCashOut(l, 'v2')),
  ].filter((r): r is CashOutRow => r !== null);
  return summarise(rows, now, v2);
}

/** GET /stats */
export async function handleStats(env: StatsEnv): Promise<Response> {
  const edge = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  const cacheKey = new Request('https://cache.goodcash.invalid/public-stats');
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_SECONDS}`, 'Access-Control-Allow-Origin': '*' };

  const hit = await edge?.match(cacheKey);
  if (hit) return new Response(hit.body, { status: 200, headers });

  let stats: Stats | null = null;
  try {
    stats = await buildStats(env);
    const saved = await env.ORDER_STORE.get(SNAPSHOT_KEY).catch(() => null);
    const previous = saved ? (JSON.parse(saved) as Stats) : null;
    if (!previous || previous.totals.cashOuts !== stats.totals.cashOuts || previous.totals.gDollars !== stats.totals.gDollars) {
      await env.ORDER_STORE.put(SNAPSHOT_KEY, JSON.stringify(stats)).catch(() => undefined);
    }
  } catch (e) {
    console.error('[stats] explorer read failed:', e);
    const saved = await env.ORDER_STORE.get(SNAPSHOT_KEY).catch(() => null);
    if (saved) stats = JSON.parse(saved) as Stats;
  }
  if (!stats) return new Response(JSON.stringify({ error: 'Numbers are not available right now. Please try again shortly.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });

  const response = new Response(JSON.stringify(stats), { status: 200, headers });
  await edge?.put(cacheKey, response.clone());
  return response;
}
