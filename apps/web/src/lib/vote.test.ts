import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, recoverMessageAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256 } from 'viem';
import {
  askForVoteFee,
  checkCouncilCode,
  COUNCIL_CODE_HASH,
  estimateBestVote,
  GOODBUILDIT_RECIPIENT,
  buildClaimMessage,
  buildFeeMessage,
  confirmVote,
  estimateVoteFee,
  friendlyVoteError,
  GOODCASH_RECIPIENT,
  loadPendingVote,
  planVote,
  readBallot,
  readVerified,
  registerVoter,
  savePendingVote,
  sendVote,
  GOODDOLLAR_IDENTITY,
  voteData,
  VOTE_COUNCIL,
  waitForFee,
  type Ballot,
} from './vote';

vi.mock('./router', () => ({
  CELO_RPC_URL: 'https://forno.celo.org',
  ensureCeloChain: vi.fn(async () => undefined),
  getWalletProvider: vi.fn(() => null),
}));

const WALLET = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
const base: Ballot = { registered: true, power: 10, allocated: 0, mine: 0, partnerMine: 0, partnerActive: true, available: 10, active: true, spread: 0, projects: 0 };
const T = (newTotal: number, partnerTotal: number | null = null) => ({ newTotal, partnerTotal });

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('planVote (shared 50/50 with GoodBuildIt)', () => {
  const totals = (p: ReturnType<typeof planVote>) => (p.ok ? { newTotal: p.newTotal, partnerTotal: p.partnerTotal } : p);
  it('10 points: 5 to GoodCash and 5 to GoodBuildIt', () => {
    expect(planVote(base, 10)).toEqual({ ok: true, newTotal: 5, partnerTotal: 5, alone: T(10) });
  });
  it('7 points: the odd point goes to GoodCash (4 and 3)', () => {
    expect(totals(planVote({ ...base, power: 7, available: 7 }, 7))).toEqual(T(4, 3));
  });
  it('1 point: all to GoodCash, GoodBuildIt left alone', () => {
    expect(totals(planVote(base, 1))).toEqual(T(1));
  });
  it('all to GoodCash when GoodBuildIt is not an active project', () => {
    expect(totals(planVote({ ...base, partnerActive: false }, 10))).toEqual(T(10));
  });
  it('sends TOTALS, not shares: existing support stays and grows (the contract sets the total, it does not add)', () => {
    // 2 already with GoodCash, 1 with GoodBuildIt, 3 elsewhere, 4 free: GoodCash 2+2, GoodBuildIt 1+2
    expect(totals(planVote({ ...base, mine: 2, partnerMine: 1, allocated: 6, available: 4, projects: 3 }, 4))).toEqual(T(4, 3));
  });
  it('refuses what it cannot do, with a reason each', () => {
    expect(planVote({ ...base, active: false }, 1)).toEqual({ ok: false, reason: 'not_active' });
    expect(planVote({ ...base, registered: false, power: 0, available: 0 }, 1)).toEqual({ ok: false, reason: 'not_registered' });
    expect(planVote({ ...base, allocated: 10, available: 0, projects: 1 }, 1)).toEqual({ ok: false, reason: 'no_points' });
    expect(planVote(base, 11)).toEqual({ ok: false, reason: 'too_many' });
    for (const bad of [0, -1, 1.5, NaN]) expect(planVote(base, bad)).toEqual({ ok: false, reason: 'bad_amount' });
  });
  it('respects a limit on how many projects one voter can support', () => {
    // full: no room even for GoodCash
    expect(planVote({ ...base, spread: 3, projects: 3, allocated: 5, available: 5 }, 2)).toEqual({ ok: false, reason: 'too_many_projects' });
    // room for one new project only: all to GoodCash
    expect(totals(planVote({ ...base, spread: 3, projects: 2, allocated: 5, available: 5 }, 2))).toEqual(T(2));
    // room for two: shared
    expect(totals(planVote({ ...base, spread: 4, projects: 2, allocated: 5, available: 5 }, 2))).toEqual(T(1, 1));
    // already supporting both: nothing new is added, so it can share even at the limit
    expect(totals(planVote({ ...base, spread: 2, projects: 2, mine: 2, partnerMine: 2, allocated: 4, available: 6 }, 6))).toEqual(T(5, 5));
  });
  it('works for a voter with more than ten points', () => {
    expect(totals(planVote({ ...base, power: 500, available: 500 }, 500))).toEqual(T(250, 250));
  });
});

describe('voteData', () => {
  const decode = (data: `0x${string}`) => {
    const d = decodeFunctionData({
      abi: [{ type: 'function', name: 'vote', stateMutability: 'nonpayable', inputs: [{ name: '_votes', type: 'tuple[]', components: [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint96' }] }], outputs: [] }] as const,
      data,
    });
    expect(d.functionName).toBe('vote');
    return (d.args as unknown as [Array<{ recipient: string; amount: bigint }>])[0].map((v) => [v.recipient.toLowerCase(), v.amount]);
  };
  it('a shared vote sets GoodCash first, then GoodBuildIt, and nothing else', () => {
    expect(decode(voteData(T(5, 5)))).toEqual([[GOODCASH_RECIPIENT, 5n], [GOODBUILDIT_RECIPIENT, 5n]]);
  });
  it('a vote for GoodCash alone has only GoodCash in it', () => {
    expect(decode(voteData(T(7)))).toEqual([[GOODCASH_RECIPIENT, 7n]]);
  });
});

describe('checkCouncilCode', () => {
  const code = '0x6080604052' as `0x${string}`;
  it('passes only for the exact code checked on chain, and stops voting otherwise', async () => {
    await expect(checkCouncilCode({ getCode: async () => code }, keccak256(code))).resolves.toBeUndefined();
    await expect(checkCouncilCode({ getCode: async () => '0x6080604053' }, keccak256(code))).rejects.toThrow('COUNCIL_CHANGED');
    await expect(checkCouncilCode({ getCode: async () => undefined }, keccak256(code))).rejects.toThrow('COUNCIL_CHANGED');
    await expect(checkCouncilCode({ getCode: async () => '0x' }, keccak256(code))).rejects.toThrow('COUNCIL_CHANGED');
  });
  it('pins the hash read from the live council on 23 November 2026', () => {
    expect(COUNCIL_CODE_HASH).toBe('0x4f4b3bed84f524cc5162457e1ed5233b5527807945185a94a40a640bebf2c591');
  });
});

describe('readBallot', () => {
  const client = (voter: { votingPower: bigint; votes: Array<{ recipientId: bigint; amount: bigint }> }, ids: { gc?: bigint; gb?: bigint } = {}, spread = 0) => ({
    readContract: vi.fn(async (a: { functionName: string; args?: unknown[] }) => {
      if (a.functionName === 'recipientIdByAddress') return String(a.args?.[0]).toLowerCase() === GOODBUILDIT_RECIPIENT ? (ids.gb ?? 10n) : (ids.gc ?? 11n);
      if (a.functionName === 'maxVotingSpread') return spread;
      return voter;
    }),
  });

  it('adds up what a voter has given and finds GoodCash\'s and GoodBuildIt\'s shares', async () => {
    const b = await readBallot(WALLET, client({ votingPower: 10n, votes: [{ recipientId: 11n, amount: 2n }, { recipientId: 10n, amount: 1n }, { recipientId: 3n, amount: 4n }] }) as never);
    expect(b).toEqual({ registered: true, power: 10, allocated: 7, mine: 2, partnerMine: 1, partnerActive: true, available: 3, active: true, spread: 0, projects: 3 });
  });
  it('ignores projects given zero points', async () => {
    const b = await readBallot(WALLET, client({ votingPower: 10n, votes: [{ recipientId: 3n, amount: 0n }] }) as never);
    expect(b).toMatchObject({ allocated: 0, projects: 0, available: 10 });
  });
  it('says not registered for a wallet with no points, and not active when a project is not in the council', async () => {
    expect((await readBallot(WALLET, client({ votingPower: 0n, votes: [] }) as never)).registered).toBe(false);
    expect((await readBallot(WALLET, client({ votingPower: 10n, votes: [] }, { gc: 0n }) as never)).active).toBe(false);
    expect((await readBallot(WALLET, client({ votingPower: 10n, votes: [] }, { gb: 0n }) as never))).toMatchObject({ active: true, partnerActive: false, partnerMine: 0 });
  });
  it('reads at the block it is asked to', async () => {
    const c = client({ votingPower: 10n, votes: [] });
    await readBallot(WALLET, c as never, 123n);
    expect(c.readContract.mock.calls.every(([a]) => (a as unknown as { blockNumber?: bigint }).blockNumber === 123n)).toBe(true);
  });
});

describe('estimateVoteFee', () => {
  const client = (balance: bigint, gas = 400_000n, price = 25_000_000_000n) => ({
    estimateGas: vi.fn(async (_a: { data: `0x${string}` }) => gas),
    getGasPrice: vi.fn(async () => price),
    getBalance: vi.fn(async () => balance),
  });

  it('asks for 30% more gas and 50% more than today\'s price, and says whether the wallet has enough', async () => {
    const fee = await estimateVoteFee(WALLET, T(5, 5), client(10n ** 18n));
    expect(fee.gas).toBe(520_000n);
    expect(fee.feeCelo).toBeCloseTo(0.01, 6); // 400,000 x 25 gwei
    expect(fee.needCelo).toBeCloseTo(0.0195, 6); // 520,000 x 25 gwei x 1.5
    expect(fee.enough).toBe(true);
  });
  it('says not enough when the balance is below the need, and enough at exactly the need', async () => {
    const need = (520_000n * 25_000_000_000n * 3n) / 2n;
    expect((await estimateVoteFee(WALLET, T(10), client(need - 1n))).enough).toBe(false);
    expect((await estimateVoteFee(WALLET, T(10), client(need))).enough).toBe(true);
  });
  it('simulates the exact vote from the customer\'s wallet to the council', async () => {
    const c = client(10n ** 18n);
    await estimateVoteFee(WALLET, T(2, 2), c);
    expect(c.estimateGas).toHaveBeenCalledWith({ account: WALLET, to: VOTE_COUNCIL, data: voteData(T(2, 2)) });
  });
  it('throws when the contract would refuse the vote, so it is never offered', async () => {
    const c = { ...client(10n ** 18n), estimateGas: vi.fn(async () => { throw new Error('execution reverted'); }) };
    await expect(estimateVoteFee(WALLET, T(4), c)).rejects.toThrow('reverted');
  });
});

describe('estimateBestVote', () => {
  const plan = { newTotal: 5, partnerTotal: 5, alone: T(10) };
  const client = (refuseShared: boolean, refuseAlone = false) => ({
    estimateGas: vi.fn(async (a: { data: `0x${string}` }) => {
      const shared = a.data === voteData(T(5, 5));
      if ((shared && refuseShared) || (!shared && refuseAlone)) throw new Error('execution reverted');
      return 400_000n;
    }),
    getGasPrice: vi.fn(async () => 25_000_000_000n),
    getBalance: vi.fn(async () => 10n ** 18n),
  });
  it('checks the shared vote and returns it when the council accepts it', async () => {
    expect((await estimateBestVote(WALLET, plan, client(false))).totals).toEqual(T(5, 5));
  });
  it('falls back to all points for GoodCash when the shared vote would be refused, so a sharing problem never stops a vote', async () => {
    expect((await estimateBestVote(WALLET, plan, client(true))).totals).toEqual(T(10));
  });
  it('still throws when even the GoodCash-only vote would be refused', async () => {
    await expect(estimateBestVote(WALLET, plan, client(true, true))).rejects.toThrow('reverted');
  });
  it('checks once when the vote is not shared', async () => {
    const c = client(false);
    expect((await estimateBestVote(WALLET, { ...T(1), alone: T(1) }, c)).totals).toEqual(T(1));
    expect(c.estimateGas).toHaveBeenCalledTimes(1);
  });
});

describe('buildClaimMessage', () => {
  it('is exactly the text Flow State expects (checked against their live service)', () => {
    expect(buildClaimMessage(WALLET, Date.UTC(2026, 10, 19, 12, 0, 0, 789))).toBe(
      [
        'Claim voting rights in this Flow Council.',
        '',
        'Council: 0x889e0aadaa3f8b28a794ef70da147827c620a590',
        'Chain: 42220',
        `Wallet: ${WALLET.toLowerCase()}`,
        'Issued at: 2026-11-19T12:00:00Z',
      ].join('\n'),
    );
  });
});

describe('registerVoter', () => {
  // A real key signs, so the test proves the signature really belongs to the wallet and to this exact message
  const account = privateKeyToAccount(generatePrivateKey());
  const provider = () => ({
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_accounts') return [account.address.toLowerCase()];
      if (method === 'personal_sign') {
        const hex = params![0] as `0x${string}`;
        return account.signMessage({ message: { raw: hex } });
      }
      throw new Error(`unexpected ${method}`);
    }),
  });
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('signs the readable message with the customer\'s wallet and sends it with the time it was signed', async () => {
    const f = reply({ ok: true });
    expect(await registerVoter(account.address, provider(), f)).toBe('registered');
    const [url, init] = (f as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0];
    expect(url).toMatch(/\/vote\/register$/);
    const sent = JSON.parse(String(init.body)) as { address: string; issuedAt: number; signature: `0x${string}` };
    expect(sent.address).toBe(account.address);
    expect(Math.abs(Date.now() - sent.issuedAt)).toBeLessThan(5000);
    expect(await recoverMessageAddress({ message: buildClaimMessage(account.address, sent.issuedAt), signature: sent.signature })).toBe(account.address);
  });
  it('passes on what the server says, and treats anything unclear as an error', async () => {
    expect(await registerVoter(account.address, provider(), reply({ ok: false, reason: 'not_verified' }))).toBe('not_verified');
    expect(await registerVoter(account.address, provider(), reply({ ok: false, reason: 'other_wallet' }))).toBe('other_wallet');
    expect(await registerVoter(account.address, provider(), reply({ ok: false, reason: 'busy' }, 503))).toBe('busy');
    expect(await registerVoter(account.address, provider(), reply({ ok: false, reason: 'error' }, 502))).toBe('error');
    expect(await registerVoter(account.address, provider(), reply({ weird: true }))).toBe('error');
    expect(await registerVoter(account.address, provider(), vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe('error');
  });
  it('refuses to sign when the wallet is using a different account', async () => {
    const p = { request: vi.fn(async () => ['0x0000000000000000000000000000000000000001']) };
    await expect(registerVoter(account.address, p, reply({ ok: true }))).rejects.toThrow('WRONG_ACCOUNT');
    expect(p.request).toHaveBeenCalledTimes(1); // never asked to sign
  });
  it('needs a connected wallet', async () => {
    await expect(registerVoter(account.address, null, reply({ ok: true }))).rejects.toThrow('NO_WALLET');
  });
});

describe('askForVoteFee (the network fee from GoodCash)', () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const provider = () => ({
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_accounts') return [account.address.toLowerCase()];
      if (method === 'personal_sign') return account.signMessage({ message: { raw: params![0] as `0x${string}` } });
      throw new Error(`unexpected ${method}`);
    }),
  });
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('asks in the exact words the server expects (this text is pinned in services/orders/src/voteTank.test.ts too)', () => {
    expect(buildFeeMessage('0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF', Date.UTC(2026, 10, 23, 12, 0, 0, 789))).toBe(
      ['Ask GoodCash for the small network fee needed to vote.', '', 'Chain: 42220', 'Wallet: 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'Issued at: 2026-11-23T12:00:00Z'].join('\n'),
    );
  });
  it('signs with the customer\'s own wallet and sends the proof to /vote/tank', async () => {
    const f = reply({ ok: true, status: 'sent', hash: '0x1', amountCelo: 0.1 });
    expect(await askForVoteFee(account.address, provider(), f)).toBe('sent');
    const [url, init] = (f as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0];
    expect(url).toMatch(/\/vote\/tank$/);
    const sent = JSON.parse(String(init.body)) as { address: string; issuedAt: number; signature: `0x${string}` };
    expect(await recoverMessageAddress({ message: buildFeeMessage(account.address, sent.issuedAt), signature: sent.signature })).toBe(account.address);
  });
  it('reuses the voting message a first-time voter just signed: no second signature, and the server is told which message it is', async () => {
    const p = provider();
    const issuedAt = Date.now() - 1000;
    const signature = await account.signMessage({ message: buildClaimMessage(account.address, issuedAt) });
    const f = reply({ ok: true, status: 'sent' });
    expect(await askForVoteFee(account.address, p, f, { signature, issuedAt })).toBe('sent');
    expect(p.request.mock.calls.some(([a]) => a.method === 'personal_sign')).toBe(false);
    const sent = JSON.parse(String((f as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1].body));
    expect(sent).toEqual({ address: account.address, issuedAt, signature, kind: 'claim' });
  });
  it('signs a new message when the earlier one is too old', async () => {
    const p = provider();
    const issuedAt = Date.now() - 5 * 60 * 1000;
    const signature = await account.signMessage({ message: buildClaimMessage(account.address, issuedAt) });
    const f = reply({ ok: true, status: 'sent' });
    await askForVoteFee(account.address, p, f, { signature, issuedAt });
    expect(p.request.mock.calls.some(([a]) => a.method === 'personal_sign')).toBe(true);
    expect(JSON.parse(String((f as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1].body))).not.toHaveProperty('kind');
  });
  it('registerVoter hands back what it signed', async () => {
    const keep = { current: null as { signature: `0x${string}`; issuedAt: number } | null };
    const p = { request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => (method === 'eth_accounts' ? [account.address] : account.signMessage({ message: { raw: params![0] as `0x${string}` } }))) };
    await registerVoter(account.address, p, reply({ ok: true }), keep);
    expect(keep.current?.issuedAt).toBeGreaterThan(0);
    expect(await recoverMessageAddress({ message: buildClaimMessage(account.address, keep.current!.issuedAt), signature: keep.current!.signature })).toBe(account.address);
  });
  it('passes on what the server says, and treats anything unclear as an error', async () => {
    expect(await askForVoteFee(account.address, provider(), reply({ ok: true, status: 'enough' }))).toBe('enough');
    for (const reason of ['off', 'not_verified', 'already', 'empty', 'busy'] as const) {
      expect(await askForVoteFee(account.address, provider(), reply({ ok: false, reason }))).toBe(reason);
    }
    expect(await askForVoteFee(account.address, provider(), reply({ ok: false, reason: 'error' }, 502))).toBe('error');
    expect(await askForVoteFee(account.address, provider(), reply({ weird: true }))).toBe('error');
    expect(await askForVoteFee(account.address, provider(), vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe('error');
  });
  it('refuses to sign for a different account, and needs a connected wallet', async () => {
    const p = { request: vi.fn(async () => ['0x0000000000000000000000000000000000000001']) };
    await expect(askForVoteFee(account.address, p, reply({ ok: true }))).rejects.toThrow('WRONG_ACCOUNT');
    expect(p.request).toHaveBeenCalledTimes(1);
    await expect(askForVoteFee(account.address, null, reply({ ok: true }))).rejects.toThrow('NO_WALLET');
  });
});

describe('waitForFee', () => {
  it('returns as soon as the wallet holds enough, and gives up after the tries', async () => {
    const balances = [0n, 0n, 10n ** 17n];
    const arrives = { getBalance: vi.fn(async () => balances.shift() ?? 10n ** 17n) };
    expect(await waitForFee(WALLET, 0.06, arrives, 5, 1)).toBe(true);
    expect(arrives.getBalance).toHaveBeenCalledTimes(3);
    const never = { getBalance: vi.fn(async () => 0n) };
    expect(await waitForFee(WALLET, 0.06, never, 3, 1)).toBe(false);
    expect(never.getBalance).toHaveBeenCalledTimes(3);
  });
  it('keeps trying when a read fails', async () => {
    const flaky = { getBalance: vi.fn().mockRejectedValueOnce(new Error('rpc')).mockResolvedValue(10n ** 17n) };
    expect(await waitForFee(WALLET, 0.06, flaky, 3, 1)).toBe(true);
  });
});

describe('sendVote', () => {
  const HASH = `0x${'ab'.repeat(32)}` as `0x${string}`;
  it('sends exactly the vote transaction to the council, remembers it, and refuses a different account', async () => {
    const sent: unknown[] = [];
    const provider = {
      request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === 'eth_accounts') return [WALLET];
        if (method === 'eth_chainId') return '0xa4ec';
        if (method === 'eth_sendTransaction') { sent.push(params![0]); return HASH; }
        if (method === 'eth_getTransactionCount') return '0x1';
        if (method === 'eth_estimateGas') return '0x61a80';
        if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x5d21dba00';
        if (method === 'eth_getBlockByNumber') return { baseFeePerGas: '0x5d21dba00', number: '0x1', timestamp: '0x1', transactions: [] };
        throw new Error(`unexpected ${method}`);
      }),
    };
    expect(await sendVote(WALLET, T(3, 3), 520_000n, provider)).toBe(HASH);
    const tx = sent[0] as { from: string; to: string; data: string; value?: string };
    expect(tx.to.toLowerCase()).toBe(VOTE_COUNCIL);
    expect(tx.data).toBe(voteData(T(3, 3)));
    expect(tx.value ?? '0x0').toMatch(/^0x0*$/);
    expect(loadPendingVote(WALLET)).toMatchObject({ hash: HASH, newTotal: 3, partnerTotal: 3 });

    const wrong = { request: vi.fn(async () => ['0x0000000000000000000000000000000000000001']) };
    await expect(sendVote(WALLET, T(3, 3), 520_000n, wrong)).rejects.toThrow('WRONG_ACCOUNT');
  });
});

describe('confirmVote', () => {
  const HASH = `0x${'cd'.repeat(32)}` as `0x${string}`;
  const client = (receipt: unknown, mine: bigint, partner = 0n) =>
    ({
      waitForTransactionReceipt: vi.fn(async () => {
        if (receipt === 'timeout') throw new Error('timed out');
        return receipt;
      }),
      readContract: vi.fn(async (a: { functionName: string; args?: unknown[] }) => {
        if (a.functionName === 'recipientIdByAddress') return String(a.args?.[0]).toLowerCase() === GOODBUILDIT_RECIPIENT ? 10n : 11n;
        if (a.functionName === 'maxVotingSpread') return 0;
        return { votingPower: 10n, votes: [{ recipientId: 11n, amount: mine }, { recipientId: 10n, amount: partner }] };
      }),
    }) as never;

  it('is done only when the council itself shows both projects with their points', async () => {
    const r = await confirmVote(HASH, T(5, 5), WALLET, client({ status: 'success', blockNumber: 5n }, 5n, 5n));
    expect(r).toMatchObject({ status: 'done', ballot: { mine: 5, partnerMine: 5 } });
  });
  it('a GoodCash-only vote does not look at GoodBuildIt', async () => {
    expect(await confirmVote(HASH, T(10), WALLET, client({ status: 'success', blockNumber: 5n }, 10n, 3n))).toMatchObject({ status: 'done' });
  });
  it('is not done when the receipt says success but either project\'s points are not there', async () => {
    expect(await confirmVote(HASH, T(5, 5), WALLET, client({ status: 'success', blockNumber: 5n }, 4n, 5n))).toEqual({ status: 'unclear' });
    expect(await confirmVote(HASH, T(5, 5), WALLET, client({ status: 'success', blockNumber: 5n }, 5n, 0n))).toEqual({ status: 'unclear' });
  });
  it('says failed for a reverted transaction, and unclear when it cannot be seen yet (never "send again")', async () => {
    expect(await confirmVote(HASH, T(10), WALLET, client({ status: 'reverted', blockNumber: 5n }, 0n))).toEqual({ status: 'failed' });
    expect(await confirmVote(HASH, T(10), WALLET, client('timeout', 0n))).toEqual({ status: 'unclear' });
  });
});

describe('pending vote and plain words', () => {
  it('remembers a sent vote per wallet and forgets it when asked', () => {
    const HASH = `0x${'ef'.repeat(32)}` as `0x${string}`;
    savePendingVote(WALLET, { hash: HASH, newTotal: 3, partnerTotal: 2, at: 1 });
    expect(loadPendingVote(WALLET)).toEqual({ hash: HASH, newTotal: 3, partnerTotal: 2, at: 1 });
    expect(loadPendingVote('0x0000000000000000000000000000000000000001')).toBeNull();
    savePendingVote(WALLET, null);
    expect(loadPendingVote(WALLET)).toBeNull();
  });
  it('reads a vote saved before sharing began as a GoodCash-only vote', () => {
    const HASH = `0x${'ef'.repeat(32)}`;
    localStorage.setItem(`goodcash_vote_pending_${WALLET.toLowerCase()}`, JSON.stringify({ hash: HASH, newTotal: 4, at: 1 }));
    expect(loadPendingVote(WALLET)).toEqual({ hash: HASH, newTotal: 4, partnerTotal: null, at: 1 });
  });
  it('ignores a damaged saved vote', () => {
    localStorage.setItem(`goodcash_vote_pending_${WALLET.toLowerCase()}`, '{"hash":"nope","newTotal":"x"}');
    expect(loadPendingVote(WALLET)).toBeNull();
  });
  it('explains problems without technical words', () => {
    expect(friendlyVoteError({ code: 4001 })).toMatch(/cancelled/);
    expect(friendlyVoteError({ cause: { code: 4001 } })).toMatch(/cancelled/);
    expect(friendlyVoteError(new Error('insufficient funds for gas'))).toMatch(/CELO/);
    expect(friendlyVoteError(new Error('WRONG_ACCOUNT'))).toMatch(/different account/);
    expect(friendlyVoteError(new Error('boom 0xdeadbeef'))).not.toMatch(/boom|0xdead/);
  });
});

describe('readVerified', () => {
  const answer = (root: string) => ({ readContract: vi.fn(async () => root) }) as never;
  const ZERO = '0x0000000000000000000000000000000000000000';

  it('is true when GoodDollar names the wallet as its own person', async () => {
    expect(await readVerified(WALLET, answer(WALLET))).toBe(true);
  });
  it('is true for a wallet connected to a verified person (GoodDollar names a different main wallet)', async () => {
    expect(await readVerified(WALLET, answer('0xf0095e6a66770ff3c85a9173d07a140088a15569'))).toBe(true);
  });
  it('is false when GoodDollar answers with the zero address, in any letter case', async () => {
    expect(await readVerified(WALLET, answer(ZERO))).toBe(false);
  });
  it('asks GoodDollar\'s own Identity contract about exactly this wallet', async () => {
    const c = answer(ZERO) as unknown as { readContract: ReturnType<typeof vi.fn> };
    await readVerified(WALLET, c as never);
    expect(c.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: GOODDOLLAR_IDENTITY, functionName: 'getWhitelistedRoot', args: [WALLET] }));
    expect(GOODDOLLAR_IDENTITY).toBe('0xC361A6E67822a0EDc17D899227dd9FC50BD62F42');
  });
  it('throws when the chain cannot be read, so a failed check is never taken for "not verified"', async () => {
    await expect(readVerified(WALLET, { readContract: vi.fn(async () => { throw new Error('rpc down'); }) } as never)).rejects.toThrow('rpc down');
  });
});
