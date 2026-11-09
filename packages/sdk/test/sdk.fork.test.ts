// @vitest-environment node
/**
 * The transaction the SDK builds, sent through the SDK's own wallet path, against the REAL RouterV2 on a Celo
 * mainnet fork (anvil). Opt-in (needs network and anvil):  RUN_ANVIL_FORK=1 npx vitest run test/sdk.fork.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { buildOneTapTransaction, computeOneTapMinOut, encodeBalanceOf, getLiveQuote, G_DOLLAR, readWord, ROUTER_V2, USDT, type Hex } from '../src/core';
import { GoodCash, sendTransaction } from '../src';

const RUN = process.env.RUN_ANVIL_FORK === '1';
const d = RUN ? describe : describe.skip;
const FORK_URL = process.env.CELO_FORK_URL ?? 'https://forno.celo.org';
const G_WHALE = '0x9491d57c5687AB75726423B55AC2d87D1cDa2c3F';
const CUSTOMER = '0x1234567890123456789012345678901234567890' as const;
const PAY_TO = '0x00000000000000000000000000000000Ca5e0001' as const;

let anvil: ChildProcess | null = null;
let url = '';

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const b = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (b.error) throw new Error(b.error.message);
  return b.result;
}
const ethCall = async (to: Hex, data: Hex) => (await rpc('eth_call', [{ to, data }, 'latest'])) as Hex;
const balance = async (token: Hex, who: string) => readWord(await ethCall(token, encodeBalanceOf(who as Hex)), 0);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

d('SDK transaction on a Celo fork', () => {
  beforeAll(async () => {
    const port = await freePort();
    url = `http://127.0.0.1:${port}`;
    anvil = spawn('anvil', ['--fork-url', FORK_URL, '--port', String(port), '--silent', '--chain-id', '42220'], { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) {
      try {
        await rpc('eth_chainId');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    // Give the customer 5,000 G$ (from a pool on the fork) and CELO for the network fee
    await rpc('anvil_setBalance', [CUSTOMER, '0x8AC7230489E80000']);
    await rpc('anvil_setBalance', [G_WHALE, '0x8AC7230489E80000']);
    await rpc('anvil_impersonateAccount', [G_WHALE]);
    const amount = 5000n * 10n ** 18n;
    const transfer = `0xa9059cbb${CUSTOMER.slice(2).padStart(64, '0')}${amount.toString(16).padStart(64, '0')}`;
    const h = await rpc('eth_sendTransaction', [{ from: G_WHALE, to: G_DOLLAR, data: transfer }]);
    expect(h).toBeTruthy();
    await rpc('anvil_impersonateAccount', [CUSTOMER]);
  }, 60_000);

  afterAll(() => {
    anvil?.kill();
  });

  it('pays the payout address exactly and returns the rest to the customer', async () => {
    const amountWei = 5000n * 10n ** 18n;
    const quote = await getLiveQuote(amountWei, ethCall);
    const minOut = computeOneTapMinOut(quote);
    const payAmount = minOut - 30_000n;
    const block = (await rpc('eth_getBlockByNumber', ['latest', false])) as { timestamp: string };
    const now = Number(BigInt(block.timestamp));
    const orderId = '7d0c3a52-1f7e-4c55-9a51-2b7e0a1d9f00';
    const tx = buildOneTapTransaction({ router: ROUTER_V2, amountWei, route: 0, minOut, deadline: BigInt(now + 600), payTo: PAY_TO, payAmount, orderId });

    // The SDK's own check accepts it (as it would for a real order)
    const gc = new GoodCash({ publishableKey: 'gc_pk_live_' + 'a'.repeat(32) });
    const validUntil = new Date(Date.now() + 30 * 60_000).toISOString();
    gc.assertSafeTransaction({ id: orderId, amountG: '5000', transaction: tx, order: { router: ROUTER_V2, payTo: PAY_TO, payAmount: payAmount.toString(), amountWei: amountWei.toString(), minOut: minOut.toString(), validUntil } } as never, { amountG: '5000' });

    const usdtBefore = await balance(USDT, CUSTOMER);
    const gBefore = await balance(G_DOLLAR, CUSTOMER);
    const provider = { request: ({ method, params }: { method: string; params?: unknown[] }) => rpc(method, params ?? []) };
    const hash = await sendTransaction(provider, tx, CUSTOMER);
    let receipt: { status: string } | null = null;
    for (let i = 0; i < 60 && !receipt; i++) {
      receipt = (await rpc('eth_getTransactionReceipt', [hash])) as { status: string } | null;
      if (!receipt) await new Promise((r) => setTimeout(r, 500));
    }
    if (!receipt || receipt.status !== '0x1') {
      const why = await rpc('eth_call', [{ from: CUSTOMER, to: tx.to, data: tx.data }, 'latest']).catch((e) => String(e.message));
      throw new Error(`reverted: ${String(why).slice(0, 300)}`);
    }

    expect(await balance(USDT, PAY_TO)).toBe(payAmount);
    expect(gBefore - (await balance(G_DOLLAR, CUSTOMER))).toBe(amountWei);
    const surplus = (await balance(USDT, CUSTOMER)) - usdtBefore;
    expect(surplus).toBeGreaterThan(0n);
    expect(await balance(USDT, ROUTER_V2)).toBe(0n);
  }, 120_000);
});
