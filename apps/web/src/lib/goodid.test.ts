import { describe, expect, it, vi } from 'vitest';
import { decompressFromEncodedURIComponent } from 'lz-string';
import { hexToString } from 'viem';
import { buildFvLink, fvMessage, startGoodDollarVerification, takeVerifyReturn, verifyStartError } from './goodid';

const WALLET = '0xafdeebb89cda1669361117ea2eae3411f1228cb6';
const CHECKSUM = '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6';
const decode = (link: string) => JSON.parse(decompressFromEncodedURIComponent(new URL(link).searchParams.get('lz')!));

/** A wallet that is signed in with `accounts` and signs anything (returns a fixed signature) */
function wallet(accounts: string[], sign: (msg: string) => string | Promise<string> = () => '0x' + 'ab'.repeat(65)) {
  const calls: Array<{ method: string; params?: unknown[] }> = [];
  return {
    calls,
    provider: {
      request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
        calls.push({ method, params });
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return accounts;
        if (method === 'eth_chainId') return '0xa4ec';
        if (method === 'personal_sign') return sign(hexToString(String(params?.[0]) as `0x${string}`));
        throw new Error(`unexpected ${method}`);
      }),
    },
  };
}
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe('GoodDollar face verification link', () => {
  it('asks the wallet to sign GoodDollar\'s exact message, naming its own address', () => {
    expect(fvMessage(WALLET)).toBe(`Sign this message to request verifying your account ${CHECKSUM} and to create your own secret unique identifier for your anonymized record.
You can use this identifier in the future to delete this anonymized record.
WARNING: do not sign this message unless you trust the website/application requesting this signature.`);
  });

  it('builds the link GoodDollar\'s SDK builds: goodid.gooddollar.org with the wallet, signature, Celo and the way back', () => {
    const link = buildFvLink({ address: WALLET, signature: '0xsig', nonce: '1700000000', returnUrl: 'https://goodcash.xyz/?gdverify=1' });
    expect(link.startsWith('https://goodid.gooddollar.org/?lz=')).toBe(true);
    expect(decode(link)).toEqual({ account: CHECKSUM, nonce: '1700000000', fvsig: '0xsig', chain: 42220, rdu: 'https://goodcash.xyz/?gdverify=1' });
  });
});

describe('starting verification with the wallet already connected', () => {
  it('signs with the signed-in wallet, remembers what they were doing, and goes to GoodDollar (no new login)', async () => {
    const w = wallet([WALLET]);
    const storage = memory();
    const go = vi.fn();
    await startGoodDollarVerification(WALLET, 'add-g', { provider: w.provider, go, storage, now: () => 1_700_000_000_000, here: 'https://goodcash.xyz/?ref=0x1&verified=true#x' });
    const sign = w.calls.find((c) => c.method === 'personal_sign')!;
    expect(hexToString(String(sign.params![0]) as `0x${string}`)).toBe(fvMessage(WALLET));
    expect(String(sign.params![1]).toLowerCase()).toBe(WALLET);
    expect(go).toHaveBeenCalledTimes(1);
    const params = decode(go.mock.calls[0][0]);
    expect(params).toMatchObject({ account: CHECKSUM, fvsig: '0x' + 'ab'.repeat(65), nonce: '1700000000', chain: 42220 });
    // They come back to the same page (other parameters kept, an old ?verified= dropped), marked as a return trip
    expect(params.rdu).toBe('https://goodcash.xyz/?ref=0x1&gdverify=1');
    expect(JSON.parse(storage.m.get('goodcash_verify_pending')!)).toEqual({ wallet: WALLET, intent: 'add-g', at: 1_700_000_000_000 });
  });

  it('refuses when the wallet has switched to another account, and goes nowhere', async () => {
    const w = wallet(['0x2222222222222222222222222222222222222222']);
    const go = vi.fn();
    const storage = memory();
    await expect(startGoodDollarVerification(WALLET, 'cashout', { provider: w.provider, go, storage })).rejects.toThrow('WRONG_ACCOUNT');
    expect(w.calls.some((c) => c.method === 'personal_sign')).toBe(false);
    expect(go).not.toHaveBeenCalled();
    expect(storage.m.size).toBe(0);
  });

  it('a cancelled signature leaves them on the page with nothing stored', async () => {
    const w = wallet([WALLET], () => { throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); });
    const go = vi.fn();
    const storage = memory();
    const err = await startGoodDollarVerification(WALLET, 'cashout', { provider: w.provider, go, storage }).catch((e) => e);
    expect(verifyStartError(err)).toMatch(/cancelled in your wallet/);
    expect(go).not.toHaveBeenCalled();
    expect(storage.m.size).toBe(0);
  });

  it('needs a connected wallet', async () => {
    await expect(startGoodDollarVerification(WALLET, 'cashout', { provider: null, go: vi.fn() })).rejects.toThrow('NO_WALLET');
  });
});

describe('coming back from GoodDollar', () => {
  const replace = vi.fn();
  it('picks up what they were doing, and tidies the address bar', () => {
    const storage = memory();
    storage.setItem('goodcash_verify_pending', JSON.stringify({ wallet: WALLET, intent: 'add-celo', at: 1000 }));
    const back = takeVerifyReturn(WALLET.toUpperCase().replace('0X', '0x'), { href: 'https://goodcash.xyz/?ref=0x1&gdverify=1&verified=true', storage, now: () => 2000, replace });
    expect(back).toMatchObject({ intent: 'add-celo' });
    expect(replace).toHaveBeenLastCalledWith('/?ref=0x1');
    expect(storage.m.size).toBe(0);
  });
  it('still checks (and then goes to cash out) when the browser lost what they were doing', () => {
    expect(takeVerifyReturn(WALLET, { href: 'https://goodcash.xyz/?gdverify=1', storage: memory(), now: () => 1, replace })).toMatchObject({ intent: 'cashout' });
  });
  it('does nothing on a normal visit, even if a trip was started earlier', () => {
    const storage = memory();
    storage.setItem('goodcash_verify_pending', JSON.stringify({ wallet: WALLET, intent: 'vote', at: 1000 }));
    expect(takeVerifyReturn(WALLET, { href: 'https://goodcash.xyz/', storage, now: () => 2000, replace })).toBeNull();
  });
  it('ignores an old trip or one started by another wallet, and falls back to cash out', () => {
    const storage = memory();
    storage.setItem('goodcash_verify_pending', JSON.stringify({ wallet: '0x2222222222222222222222222222222222222222', intent: 'vote', at: 1000 }));
    expect(takeVerifyReturn(WALLET, { href: 'https://goodcash.xyz/?gdverify=1', storage, now: () => 2000, replace })).toMatchObject({ intent: 'cashout' });
    storage.setItem('goodcash_verify_pending', JSON.stringify({ wallet: WALLET, intent: 'vote', at: 0 }));
    expect(takeVerifyReturn(WALLET, { href: 'https://goodcash.xyz/?gdverify=1', storage, now: () => 3 * 60 * 60 * 1000, replace })).toMatchObject({ intent: 'cashout' });
  });
});
