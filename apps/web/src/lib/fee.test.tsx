import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

describe('GoodCash fee switched on (build setting VITE_GOODCASH_FEE_PERCENT=1)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GOODCASH_FEE_PERCENT', '1');
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('sizes the payout order so the customer is never asked to send more than the swap made', async () => {
    const { paycrestOrderAmount } = await import('./useOffRamp');
    expect(paycrestOrderAmount(0.57)).toBe('0.544554');
    const a = Number(paycrestOrderAmount(0.57));
    expect(a * 1.01 + 0.02).toBeLessThanOrEqual(0.57);
  });

  it('shows the fee on the review screen with its percent and a naira amount', async () => {
    const { MobileReviewView } = await import('../components/MobileReviewView');
    render(<MobileReviewView amountG={5000} nairaEstimate={727} usdtEstimate={0.57} onBack={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText('GoodCash fee (1%)')).toBeInTheDocument();
    expect(screen.getByText('about ₦7')).toBeInTheDocument();
  });

  it('tells the server which fee percent it showed, on both kinds of order', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(JSON.stringify({ orderId: 'o', receiveAddress: '0x1111111111111111111111111111111111111111', amountToSend: '0.55', validUntil: new Date(Date.now() + 9e5).toISOString(), status: 'initiated', payAmountAtomic: '550000', routerAddress: '0x2222222222222222222222222222222222222222' }), { status: 201 });
      })
    );
    const { createPaycrestOrder, createOneTapOrder } = await import('./useOffRamp');
    const recipient = { institution: 'GTBINGLA', accountIdentifier: '0123456789', accountName: 'A B' };
    await createOneTapOrder({ minUsdt: '0.570000', amountG: '5000', refundAddress: '0x1111111111111111111111111111111111111111', recipient });
    await createPaycrestOrder({ swapTxHash: '0x' + 'ab'.repeat(32), usdtReceived: 0.57, amountUsdt: '0.544554', refundAddress: '0x1111111111111111111111111111111111111111', recipient });
    expect(bodies.map((b) => b.feePercent)).toEqual([1, 1]);
    vi.unstubAllGlobals();
  });

  it('ignores a silly setting, so a typo can never show or charge a big fee', async () => {
    vi.stubEnv('VITE_GOODCASH_FEE_PERCENT', '50');
    vi.resetModules();
    const { GOODCASH_FEE_PERCENT } = await import('./units');
    expect(GOODCASH_FEE_PERCENT).toBe(0);
  });
});

describe('with no fee setting (the default)', () => {
  it('shows no GoodCash fee row and sizes orders as before', async () => {
    vi.resetModules();
    const { MobileReviewView } = await import('../components/MobileReviewView');
    render(<MobileReviewView amountG={5000} nairaEstimate={727} usdtEstimate={0.57} onBack={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByText(/GoodCash fee/)).not.toBeInTheDocument();
    const { paycrestOrderAmount } = await import('./useOffRamp');
    expect(paycrestOrderAmount(0.57)).toBe('0.550000');
  });
});
