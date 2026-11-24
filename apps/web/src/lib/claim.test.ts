import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, keccak256, toHex } from 'viem';
import { askClaimGas, confirmClaim, friendlyClaimError, needsClaimGas, readClaim, timeUntil, UBI_SCHEME } from './claim';

const W = '0x2222222222222222222222222222222222222222';
const DAY = 24 * 3600 * 1000;

function client(over: Partial<Record<string, unknown>> = {}) {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'checkEntitlement') return (over.entitlement as bigint) ?? 0n;
      if (functionName === 'periodStart') return 1_677_672_000n;
      if (functionName === 'currentDay') return 1364n;
      throw new Error('unknown');
    }),
    getBalance: vi.fn(async () => (over.balance as bigint) ?? 0n),
    getGasPrice: vi.fn(async () => 200_000_000_000n),
    waitForTransactionReceipt: vi.fn(async () => over.receipt),
  } as never;
}

describe('readClaim', () => {
  it('says how much is ready now', async () => {
    expect(await readClaim(W, client({ entitlement: 120_872_477_983_376_388_903n }))).toEqual({ readyG: 120.8724, nextAt: 0 });
  });

  it('says when the next claim opens once today is claimed', async () => {
    const dayStart = 1_677_672_000_000 + 1364 * DAY;
    expect(await readClaim(W, client(), dayStart + 1000)).toEqual({ readyG: 0, nextAt: dayStart + DAY });
  });
});

describe('needsClaimGas', () => {
  it('needs the fee below 250,000 gas at the current price plus a fifth', async () => {
    expect(await needsClaimGas(W, client({ balance: 10n ** 16n }))).toBe(true); // 0.01 CELO
    expect(await needsClaimGas(W, client({ balance: 10n ** 17n }))).toBe(false); // 0.1 CELO
  });
});

describe('askClaimGas', () => {
  it('passes on the server answer and treats anything else as refused', async () => {
    const f = (body: unknown) => vi.fn(async () => Response.json(body)) as unknown as typeof fetch;
    expect(await askClaimGas(W, f({ ok: true, status: 'sent' }))).toBe('sent');
    expect(await askClaimGas(W, f({ ok: false, reason: 'refused' }))).toBe('refused');
  });
});

describe('confirmClaim', () => {
  it('reads the G$ received from the claim event', async () => {
    const topic = keccak256(toHex('UBIClaimed(address,uint256)'));
    const log = { address: UBI_SCHEME, topics: [topic, `0x${'0'.repeat(24)}${W.slice(2)}`], data: encodeAbiParameters([{ type: 'uint256' }], [120_500_000_000_000_000_000n]) };
    expect(await confirmClaim('0xabc', client({ receipt: { status: 'success', logs: [log] } }))).toBe(120.5);
  });

  it('throws when the claim failed on the chain', async () => {
    await expect(confirmClaim('0xabc', client({ receipt: { status: 'reverted', logs: [] } }))).rejects.toThrow('CLAIM_FAILED');
  });
});

describe('plain words', () => {
  it('counts down in hours and minutes', () => {
    expect(timeUntil(5 * 3600_000 + 12 * 60_000, 0)).toBe('5h 12m');
    expect(timeUntil(12 * 60_000, 0)).toBe('12m');
    expect(timeUntil(30_000, 0)).toBe('less than a minute');
  });

  it('explains a cancel and a missing fee without jargon', () => {
    expect(friendlyClaimError({ code: 4001 })).toMatch(/cancelled/);
    expect(friendlyClaimError(new Error('NO_GAS'))).toMatch(/little CELO/);
    expect(friendlyClaimError(new Error('boom'))).toMatch(/Nothing was taken/);
  });
});
