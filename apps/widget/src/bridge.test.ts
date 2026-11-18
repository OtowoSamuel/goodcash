import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { hostWalletProvider, verifyHostSignature } from './bridge';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const ME = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const OTHER = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const ORIGIN = 'https://game.example';

const typed = (from: string) => ({
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    ReceiveWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'ReceiveWithAuthorization',
  domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
  message: { from, to: '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be', value: '3500000', validAfter: '0', validBefore: '4102444800', nonce: '0x' + '11'.repeat(32) },
});

async function signWith(acct: typeof ME, t = typed(ME.address)) {
  const { EIP712Domain: _d, ...types } = t.types;
  return acct.signTypedData({ domain: { ...t.domain, chainId: 8453n }, types, primaryType: 'ReceiveWithAuthorization', message: { ...t.message, value: 3500000n, validAfter: 0n, validBefore: 4102444800n } as never });
}

describe('checking the permit the app signed', () => {
  it('accepts a signature made by the named wallet', async () => {
    const sig = await signWith(ME);
    await expect(verifyHostSignature(JSON.stringify(typed(ME.address)), ME.address, sig)).resolves.toBeUndefined();
  });
  it('refuses a signature made by another wallet', async () => {
    const sig = await signWith(OTHER, typed(ME.address));
    await expect(verifyHostSignature(JSON.stringify(typed(ME.address)), ME.address, sig)).rejects.toThrow(/did not come from your wallet/);
  });
  it('refuses a signature for different details', async () => {
    const sig = await signWith(ME);
    const changed = typed(ME.address);
    changed.message.value = '9999999';
    await expect(verifyHostSignature(JSON.stringify(changed), ME.address, sig)).rejects.toThrow(/did not come from your wallet/);
  });
  it('refuses anything that is not a plain 65-byte signature', async () => {
    for (const bad of ['', '0x', '0x1234', 'nonsense', '0x' + 'zz'.repeat(65)]) {
      await expect(verifyHostSignature(JSON.stringify(typed(ME.address)), ME.address, bad)).rejects.toThrow(/form we do not accept/);
    }
  });
});

describe('a wallet that lives on the partner page', () => {
  const posted: unknown[] = [];
  const fakeHost = { postMessage: (m: unknown) => posted.push(m) };

  beforeEach(() => {
    posted.length = 0;
    Object.defineProperty(window, 'opener', { value: fakeHost, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
  });

  function reply(over: Record<string, unknown>, origin = ORIGIN, source: unknown = fakeHost) {
    const id = (posted[0] as { id: string }).id;
    const ev = new MessageEvent('message', { data: { source: 'goodcash-host', type: 'sign_result', id, ...over }, origin });
    Object.defineProperty(ev, 'source', { value: source });
    window.dispatchEvent(ev);
  }
  const withOrder = (p = hostWalletProvider(ORIGIN, ME.address), max = '3551428') => {
    p.setOrder({ orderId: '6f1c0f2e-1111-4222-8333-444455556666', maxUsdc: max });
    return p;
  };
  const call = (p = withOrder(), who = ME.address, t = typed(ME.address)) => p.request({ method: 'eth_signTypedData_v4', params: [who, JSON.stringify(t)] });

  it('asks the app (only at its own address) and returns the signature it gave', async () => {
    const sig = await signWith(ME);
    const pending = call();
    await vi.waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toMatchObject({ source: 'goodcash', type: 'sign_typed_data_request', wallet: ME.address, orderId: '6f1c0f2e-1111-4222-8333-444455556666', maxUsdc: '3551428' });
    reply({ signature: sig });
    await expect(pending).resolves.toBe(sig);
  });
  it('ignores an answer from another site or another window', async () => {
    const sig = await signWith(ME);
    const pending = call();
    await vi.waitFor(() => expect(posted.length).toBe(1));
    reply({ signature: '0x' + 'ab'.repeat(65) }, 'https://evil.example');
    reply({ signature: '0x' + 'ab'.repeat(65) }, ORIGIN, {});
    reply({ signature: sig });
    await expect(pending).resolves.toBe(sig);
  });
  it('refuses a signature from a different wallet than the one named', async () => {
    const pending = call();
    await vi.waitFor(() => expect(posted.length).toBe(1));
    reply({ signature: await signWith(OTHER, typed(ME.address)) });
    await expect(pending).rejects.toThrow(/did not come from your wallet/);
  });
  it('passes on the app\'s refusal (the customer cancelled)', async () => {
    const pending = call();
    await vi.waitFor(() => expect(posted.length).toBe(1));
    reply({ error: { code: 4001, message: 'User rejected the request' } });
    await expect(pending).rejects.toMatchObject({ code: 4001 });
  });
  it('does nothing but the one signature, and never for a different address', async () => {
    const p = withOrder();
    await expect(p.request({ method: 'eth_chainId' })).resolves.toBe('0x2105');
    await expect(p.request({ method: 'eth_sendTransaction', params: [{}] })).rejects.toThrow(/cannot do that step/);
    await expect(call(p, OTHER.address)).rejects.toThrow(/did not match/);
    expect(posted).toHaveLength(0);
  });

  it('asks for nothing until it knows the order and its maximum', async () => {
    await expect(call(hostWalletProvider(ORIGIN, ME.address))).rejects.toThrow(/price was not ready/);
    expect(posted).toHaveLength(0);
  });
  it('never asks the app to sign more than the order may convert (3,500,000 is the amount in the permit)', async () => {
    await expect(call(withOrder(undefined, '3499999'))).rejects.toThrow(/did not match/);
    expect(posted).toHaveLength(0);
  });
});
