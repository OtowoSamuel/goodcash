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
