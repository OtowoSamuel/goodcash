import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, recoverMessageAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  askForVoteFee,
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
const base: Ballot = { registered: true, power: 10, allocated: 0, mine: 0, available: 10, active: true, spread: 0, projects: 0 };

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('planVote', () => {
  it('gives all ten points to a new voter by default', () => {
    expect(planVote(base, 10)).toEqual({ ok: true, newTotal: 10 });
  });
  it('sets GoodCash\'s total: existing support plus the new points (the contract sets the total, it does not add)', () => {
    // two points already with GoodCash, five elsewhere, three free: adding the three makes five
    expect(planVote({ ...base, power: 10, allocated: 7, mine: 2, available: 3, projects: 2 }, 3)).toEqual({ ok: true, newTotal: 5 });
  });
  it('refuses what it cannot do, with a reason each', () => {
    expect(planVote({ ...base, active: false }, 1)).toEqual({ ok: false, reason: 'not_active' });
    expect(planVote({ ...base, registered: false, power: 0, available: 0 }, 1)).toEqual({ ok: false, reason: 'not_registered' });
    expect(planVote({ ...base, allocated: 10, available: 0, projects: 1 }, 1)).toEqual({ ok: false, reason: 'no_points' });
    expect(planVote(base, 11)).toEqual({ ok: false, reason: 'too_many' });
    for (const bad of [0, -1, 1.5, NaN]) expect(planVote(base, bad)).toEqual({ ok: false, reason: 'bad_amount' });
  });
  it('respects a limit on how many projects one voter can support', () => {
    expect(planVote({ ...base, spread: 3, projects: 3, allocated: 5, available: 5 }, 2)).toEqual({ ok: false, reason: 'too_many_projects' });
    expect(planVote({ ...base, spread: 3, projects: 2, allocated: 5, available: 5 }, 2)).toEqual({ ok: true, newTotal: 2 });
    // already supporting GoodCash: no new project is added
    expect(planVote({ ...base, spread: 1, projects: 1, mine: 4, allocated: 4, available: 6 }, 2)).toEqual({ ok: true, newTotal: 6 });
  });
  it('works for a voter with more than ten points', () => {
    expect(planVote({ ...base, power: 500, available: 500 }, 500)).toEqual({ ok: true, newTotal: 500 });
  });
});

describe('voteData', () => {
  it('is one vote for GoodCash alone, and nothing else', () => {
    const decoded = decodeFunctionData({
      abi: [{ type: 'function', name: 'vote', stateMutability: 'nonpayable', inputs: [{ name: '_votes', type: 'tuple[]', components: [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint96' }] }], outputs: [] }] as const,
      data: voteData(7),
    });
    expect(decoded.functionName).toBe('vote');
    const [votes] = decoded.args as unknown as [Array<{ recipient: string; amount: bigint }>];
    expect(votes).toHaveLength(1);
    expect(votes[0].recipient.toLowerCase()).toBe(GOODCASH_RECIPIENT);
    expect(votes[0].amount).toBe(7n);
  });
});

describe('readBallot', () => {
  const client = (voter: { votingPower: bigint; votes: Array<{ recipientId: bigint; amount: bigint }> }, recipientId = 11n, spread = 0) => ({
    readContract: vi.fn(async (a: { functionName: string }) => {
      if (a.functionName === 'recipientIdByAddress') return recipientId;
      if (a.functionName === 'maxVotingSpread') return spread;
      return voter;
    }),
  });

  it('adds up what a voter has given and finds GoodCash\'s share', async () => {
    const b = await readBallot(WALLET, client({ votingPower: 10n, votes: [{ recipientId: 11n, amount: 2n }, { recipientId: 3n, amount: 5n }] }) as never);
    expect(b).toEqual({ registered: true, power: 10, allocated: 7, mine: 2, available: 3, active: true, spread: 0, projects: 2 });
  });
  it('ignores projects given zero points', async () => {
    const b = await readBallot(WALLET, client({ votingPower: 10n, votes: [{ recipientId: 3n, amount: 0n }] }) as never);
    expect(b).toMatchObject({ allocated: 0, projects: 0, available: 10 });
  });
  it('says not registered for a wallet with no points, and not active when GoodCash is not in the council', async () => {
    expect((await readBallot(WALLET, client({ votingPower: 0n, votes: [] }) as never)).registered).toBe(false);
    expect((await readBallot(WALLET, client({ votingPower: 10n, votes: [] }, 0n) as never)).active).toBe(false);
  });
  it('reads at the block it is asked to', async () => {
    const c = client({ votingPower: 10n, votes: [] });
    await readBallot(WALLET, c as never, 123n);
    expect(c.readContract.mock.calls.every(([a]) => (a as unknown as { blockNumber?: bigint }).blockNumber === 123n)).toBe(true);
  });
});

describe('estimateVoteFee', () => {
  const client = (balance: bigint, gas = 400_000n, price = 25_000_000_000n) => ({
    estimateGas: vi.fn(async () => gas),
    getGasPrice: vi.fn(async () => price),
    getBalance: vi.fn(async () => balance),
  });

  it('asks for 30% more gas and 50% more than today\'s price, and says whether the wallet has enough', async () => {
    const fee = await estimateVoteFee(WALLET, 10, client(10n ** 18n));
    expect(fee.gas).toBe(520_000n);
    expect(fee.feeCelo).toBeCloseTo(0.01, 6); // 400,000 x 25 gwei
    expect(fee.needCelo).toBeCloseTo(0.0195, 6); // 520,000 x 25 gwei x 1.5
    expect(fee.enough).toBe(true);
  });
  it('says not enough when the balance is below the need, and enough at exactly the need', async () => {
    const need = (520_000n * 25_000_000_000n * 3n) / 2n;
    expect((await estimateVoteFee(WALLET, 10, client(need - 1n))).enough).toBe(false);
    expect((await estimateVoteFee(WALLET, 10, client(need))).enough).toBe(true);
  });
  it('simulates the exact vote from the customer\'s wallet to the council', async () => {
    const c = client(10n ** 18n);
    await estimateVoteFee(WALLET, 4, c);
    expect(c.estimateGas).toHaveBeenCalledWith({ account: WALLET, to: VOTE_COUNCIL, data: voteData(4) });
  });
  it('throws when the contract would refuse the vote, so it is never offered', async () => {
    const c = { ...client(10n ** 18n), estimateGas: vi.fn(async () => { throw new Error('execution reverted'); }) };
    await expect(estimateVoteFee(WALLET, 4, c)).rejects.toThrow('reverted');
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
    expect(await sendVote(WALLET, 6, 520_000n, provider)).toBe(HASH);
    const tx = sent[0] as { from: string; to: string; data: string; value?: string };
    expect(tx.to.toLowerCase()).toBe(VOTE_COUNCIL);
    expect(tx.data).toBe(voteData(6));
    expect(tx.value ?? '0x0').toMatch(/^0x0*$/);
    expect(loadPendingVote(WALLET)).toMatchObject({ hash: HASH, newTotal: 6 });

    const wrong = { request: vi.fn(async () => ['0x0000000000000000000000000000000000000001']) };
    await expect(sendVote(WALLET, 6, 520_000n, wrong)).rejects.toThrow('WRONG_ACCOUNT');
  });
});

describe('confirmVote', () => {
  const HASH = `0x${'cd'.repeat(32)}` as `0x${string}`;
  const client = (receipt: unknown, mine: bigint) =>
    ({
      waitForTransactionReceipt: vi.fn(async () => {
        if (receipt === 'timeout') throw new Error('timed out');
        return receipt;
      }),
      readContract: vi.fn(async (a: { functionName: string }) => {
        if (a.functionName === 'recipientIdByAddress') return 11n;
        if (a.functionName === 'maxVotingSpread') return 0;
        return { votingPower: 10n, votes: [{ recipientId: 11n, amount: mine }] };
      }),
    }) as never;

  it('is done only when the council itself shows GoodCash with the points', async () => {
    const r = await confirmVote(HASH, 10, WALLET, client({ status: 'success', blockNumber: 5n }, 10n));
    expect(r).toMatchObject({ status: 'done', ballot: { mine: 10 } });
  });
  it('is not done when the receipt says success but the points are not there', async () => {
    expect(await confirmVote(HASH, 10, WALLET, client({ status: 'success', blockNumber: 5n }, 4n))).toEqual({ status: 'unclear' });
  });
  it('says failed for a reverted transaction, and unclear when it cannot be seen yet (never "send again")', async () => {
    expect(await confirmVote(HASH, 10, WALLET, client({ status: 'reverted', blockNumber: 5n }, 0n))).toEqual({ status: 'failed' });
    expect(await confirmVote(HASH, 10, WALLET, client('timeout', 0n))).toEqual({ status: 'unclear' });
  });
});

describe('pending vote and plain words', () => {
  it('remembers a sent vote per wallet and forgets it when asked', () => {
    const HASH = `0x${'ef'.repeat(32)}` as `0x${string}`;
    savePendingVote(WALLET, { hash: HASH, newTotal: 3, at: 1 });
    expect(loadPendingVote(WALLET)).toEqual({ hash: HASH, newTotal: 3, at: 1 });
    expect(loadPendingVote('0x0000000000000000000000000000000000000001')).toBeNull();
    savePendingVote(WALLET, null);
    expect(loadPendingVote(WALLET)).toBeNull();
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
