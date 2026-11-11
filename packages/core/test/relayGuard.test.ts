import { describe, expect, it } from 'vitest';
import { checkRelayQuote, RELAY_APPROVAL_PROXIES } from '../src/relayGuard';

const WALLET = '0xafdeebb89cda1669361117ea2eae3411f1228cb6';
const NOW = 1794402112;
const REQ = '0x179440211214b138ee76c76e476d1afbd5bf577453d21b91401283233bcfe134';

/** The shape of a real answer from the swap service (captured 11 Nov 2026), for 5 USDC on Base -> G$ on Celo. */
function quote(over: { value?: Record<string, unknown>; domain?: Record<string, unknown>; details?: Record<string, unknown>; post?: Record<string, unknown>; extraStep?: boolean; sign?: Record<string, unknown> } = {}) {
  const item = {
    data: {
      sign: {
        signatureKind: 'eip712',
        types: {
          ReceiveWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', ...over.domain },
        primaryType: 'ReceiveWithAuthorization',
        value: {
          from: WALLET,
          to: '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be',
          value: '5000000',
          validAfter: 0,
          validBefore: NOW + 600,
          nonce: '0x8cb1a8c72968eb50222bbff7e62fc007e01f947265d529b777dab4b9d8840997',
          ...over.value,
        },
        ...over.sign,
      },
      post: { endpoint: '/execute/permits', method: 'POST', body: { kind: 'eip3009', requestId: REQ, api: 'swap' }, ...over.post },
    },
  };
  return {
    requestId: REQ,
    steps: [{ id: 'authorize1', items: [item] }, ...(over.extraStep ? [{ id: 'swap', items: [{}] }] : [])],
    details: {
      sender: WALLET,
      recipient: WALLET,
      currencyIn: { currency: { chainId: 8453, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }, amount: '5000000' },
      currencyOut: { currency: { chainId: 42220, address: '0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a' }, amount: '43003025979447808060208' },
      ...over.details,
    },
  };
}
const ok = (q: ReturnType<typeof quote>, asset: 'g' | 'celo' = 'g', amount = 5_000_000n) => checkRelayQuote(q, { wallet: WALLET, amount, asset, nowSeconds: NOW });

describe('checkRelayQuote', () => {
  it('accepts the real answer for this wallet and amount', () => {
    expect(ok(quote()).api).toBe('swap');
  });

  it('accepts either of the swap service\'s approval contracts', () => {
    for (const to of RELAY_APPROVAL_PROXIES) expect(() => ok(quote({ value: { to } }))).not.toThrow();
  });

  const bad: Array<[string, ReturnType<typeof quote>, ('g' | 'celo')?]> = [
    ['destination is some other address', quote({ value: { to: '0x1111111111111111111111111111111111111111' } })],
    ['destination is the wallet itself', quote({ value: { to: WALLET } })],
    ['payer is another wallet', quote({ value: { from: '0x2222222222222222222222222222222222222222' } })],
    ['amount is higher', quote({ value: { value: '5000001' } })],
    ['amount is lower', quote({ value: { value: '4999999' } })],
    ['already expired', quote({ value: { validBefore: NOW - 1 } })],
    ['valid for far too long', quote({ value: { validBefore: NOW + 86_400 } })],
    ['not valid yet', quote({ value: { validAfter: NOW + 100 } })],
    ['nonce is not 32 bytes', quote({ value: { nonce: '0x1234' } })],
    ['another token', quote({ domain: { verifyingContract: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2' } })],
    ['another network', quote({ domain: { chainId: 1 } })],
    ['another token name', quote({ domain: { name: 'Tether USD' } })],
    ['a second step is hidden alongside', quote({ extraStep: true })],
    ['a different kind of message', quote({ sign: { primaryType: 'Permit' } })],
    ['the message has an extra field', quote({ sign: { types: { ReceiveWithAuthorization: [{ name: 'from', type: 'address' }] } } })],
    ['it would be sent to another endpoint', quote({ post: { endpoint: '/execute/other' } })],
    ['it is for another request', quote({ post: { body: { kind: 'eip3009', requestId: `0x${'ab'.repeat(32)}`, api: 'swap' } } })],
    ['the result goes to another wallet', quote({ details: { recipient: '0x3333333333333333333333333333333333333333' } })],
    ['the swap pays out another token', quote({ details: { currencyOut: { currency: { chainId: 42220, address: '0x3333333333333333333333333333333333333333' } } } })],
    ['the swap pays out on another network', quote({ details: { currencyOut: { currency: { chainId: 1, address: '0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a' } } } })],
    ['the swap input is another amount', quote({ details: { currencyIn: { currency: { chainId: 8453, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }, amount: '6000000' } } })],
  ];
  it.each(bad)('refuses when %s', (_name, q, asset) => {
    expect(() => ok(q, asset)).toThrow(/did not match/);
  });

  it('refuses a G$ answer when CELO was asked for, and the other way round', () => {
    expect(() => ok(quote(), 'celo')).toThrow(/swap output/);
    const celo = quote({ details: { currencyOut: { currency: { chainId: 42220, address: '0x0000000000000000000000000000000000000000' } } } });
    expect(() => ok(celo, 'celo')).not.toThrow();
    expect(() => ok(celo, 'g')).toThrow(/swap output/);
  });

  it('refuses an answer with no signing request at all', () => {
    expect(() => checkRelayQuote({ requestId: REQ, steps: [], details: {} }, { wallet: WALLET, amount: 5_000_000n, asset: 'g' })).toThrow(/did not match/);
  });
});
