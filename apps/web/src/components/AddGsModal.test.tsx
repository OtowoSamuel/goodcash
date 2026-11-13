import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AddGsModal } from './AddGsModal';

const WALLET = '0x1111111111111111111111111111111111111111';
const store = new Map<string, string>();

describe('Add G$ / Add CELO choice', () => {
  let urls: string[];
  beforeEach(() => {
    store.clear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() },
    });
    urls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        urls.push(u);
        if (u.includes('/institutions/')) return new Response(JSON.stringify({ institutions: [] }));
        const celo = u.includes('asset=celo');
        return new Response(
          JSON.stringify({ naira: 1000, ngnPerUsd: 1384.5, swapFeeUsd: 0.03, minNaira: 800, validForSeconds: 30, gOut: celo ? 10.26 : 30000, gOutMin: celo ? 10.1 : 29500, amountOut: celo ? 10.26 : 30000, amountOutMin: celo ? 10.1 : 29500, asset: celo ? 'celo' : 'g' })
        );
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks for a G$ price by default and a CELO price when CELO is chosen, in words the customer knows', async () => {
    render(<AddGsModal wallet={WALLET} onClose={() => {}} onArrived={() => {}} />);
    expect(screen.getByRole('dialog', { name: /add g\$/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Amount in naira'), { target: { value: '1000' } });
    expect(await screen.findByText(/29,500 G\$/)).toBeInTheDocument();
    expect(urls.some((u) => u.includes('/onramp/quote') && u.includes('asset=g'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /CELO \(for fees\)/ }));
    expect(await screen.findByText(/10\.10 CELO/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /add celo/i })).toBeInTheDocument();
    expect(screen.getByText(/pays the small network fee/i)).toBeInTheDocument();
    expect(urls.some((u) => u.includes('asset=celo'))).toBe(true);
    // the step bar names what they are getting
    expect(screen.getByText('Get CELO')).toBeInTheDocument();
  });

  it('opens already on CELO when the top-up notice sent them here', () => {
    render(<AddGsModal wallet={WALLET} onClose={() => {}} onArrived={() => {}} initialAsset="celo" />);
    expect(screen.getByRole('button', { name: /CELO \(for fees\)/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('dialog', { name: /add celo/i })).toBeInTheDocument();
  });

  it('an order already open keeps its own choice, whatever the button said', () => {
    store.set(
      'goodcash_addg_order',
      JSON.stringify({ wallet: WALLET, asset: 'celo', sent: true, order: { orderId: 'o', status: 'initiated', bank: { institution: 'B', accountIdentifier: '1', accountName: 'P' }, amountToTransfer: '1000', validUntil: '2030-01-01T00:00:00Z' } })
    );
    render(<AddGsModal wallet={WALLET} onClose={() => {}} onArrived={() => {}} initialAsset="g" />);
    expect(screen.getByRole('dialog', { name: /add celo/i })).toBeInTheDocument();
  });
});

describe('an unclear answer after the customer has signed', () => {
  const ORDER_ID = '660e8400-e29b-41d4-a716-446655440001';
  const REQ = '0x' + 'ab'.repeat(32);
  const CAP = 3_551_428n;
  const quoteBody = (amount: string) => ({
    requestId: REQ,
    steps: [
      {
        id: 'authorize1',
        items: [
          {
            data: {
              sign: {
                signatureKind: 'eip712',
                types: { ReceiveWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
                domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
                primaryType: 'ReceiveWithAuthorization',
                value: { from: WALLET.toLowerCase(), to: '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be', value: amount, validAfter: 0, validBefore: Math.floor(Date.now() / 1000) + 600, nonce: '0x' + '12'.repeat(32) },
              },
              post: { endpoint: '/execute/permits', method: 'POST', body: { kind: 'eip3009', requestId: REQ, api: 'swap' } },
            },
          },
        ],
      },
    ],
    details: {
      sender: WALLET.toLowerCase(),
      recipient: WALLET.toLowerCase(),
      currencyIn: { currency: { chainId: 8453, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }, amount },
      currencyOut: { currency: { chainId: 42220, address: '0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a' }, amount: '1', minimumAmount: '1' },
    },
  });

  let signCalls: number;
  let executeCalls: number;
  let quoteCalls: number;
  beforeEach(() => {
    store.clear();
    signCalls = 0;
    executeCalls = 0;
    quoteCalls = 0;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() },
    });
    store.set(
      'goodcash_addg_order',
      JSON.stringify({ wallet: WALLET, asset: 'g', sent: true, order: { orderId: ORDER_ID, status: 'settled', bank: { institution: 'B', accountIdentifier: '1', accountName: 'P' }, amountToTransfer: '5000', validUntil: '2030-01-01T00:00:00Z' } })
    );
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return '0x2105';
        if (method === 'eth_signTypedData_v4') {
          signCalls++;
          return '0x' + 'ee'.repeat(65);
        }
        return null;
      }),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/onramp/orders/')) return new Response(JSON.stringify({ orderId: ORDER_ID, status: 'settled', stage: 'done', maxUsdc: CAP.toString() }));
        if (u.includes('/relay/quote')) {
          quoteCalls++;
          return new Response(JSON.stringify(quoteBody(String(JSON.parse(String(init?.body)).amount))));
        }
        if (u.includes('/relay/execute')) {
          executeCalls++;
          return new Response(JSON.stringify({ error: 'We could not confirm whether this went through.', uncertain: true, requestId: REQ }), { status: 503 });
        }
        if (u.includes('/relay/status')) return new Response(JSON.stringify({ status: 'pending' }));
        if (u.includes('/history') || u.includes('/diag')) return new Response('{}');
        // the Base node: the wallet holds more dollars than this order delivers
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + (CAP * 3n).toString(16).padStart(64, '0') }));
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { ethereum?: unknown }).ethereum;
  });

  it('follows the attempt on the working screen, and does not ask for a second signature', async () => {
    render(<AddGsModal wallet={WALLET} onClose={() => {}} onArrived={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /get my g\$/i }));
    // the server could not tell whether it took the signature: we follow it, nothing says "nothing was taken"
    expect(await screen.findByText(/turning your/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing was taken/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /get my g\$/i })).not.toBeInTheDocument();
    expect(signCalls).toBe(1);
    expect(executeCalls).toBe(1);
    expect(quoteCalls).toBe(1);
    // the request id is kept, so a reload follows the same attempt instead of starting another
    expect(JSON.parse(store.get('goodcash_addg_order')!).swapRequestId).toBe(REQ);
  });
});
