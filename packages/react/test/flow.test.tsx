import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildOneTapTransaction, ROUTER_V2 } from '../../core/src';
import { CashOutButton, CashOutFlow, GoodCashProvider, GOODCASH_CSS } from '../src';

afterEach(cleanup);

const ID = '7d0c3a52-1f7e-4c55-9a51-2b7e0a1d9f00';
const QUOTE = {
  object: 'quote', mode: 'test', amountG: '5000', receive: { naira: 780.5, minimumNaira: 770 }, feePercent: 1.5,
  fees: [
    { type: 'gooddollar_contribution', label: 'GoodDollar contribution (10%)', amountG: '500.00' },
    { type: 'goodcash_fee', label: 'GoodCash fee (1%)', naira: 7.8 },
    { type: 'partner_fee', label: 'Test Game fee (0.5%)', naira: 3.9 },
    { type: 'payout_fee', label: 'Bank payout fee', naira: 30 },
  ],
  minimumG: 4700, enough: true, nairaPerDollar: 1500, expiresAt: '',
};

function fakeApi(status: string[] = ['sent', 'processing', 'paid']) {
  let polls = 0;
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (url.includes('/v1/quote')) return json({ ...QUOTE, enough: !url.includes('amountG=10&') && !url.endsWith('amountG=10') });
    if (url.endsWith('/v1/banks')) return json({ object: 'list', data: [{ code: 'TESTBANKA', name: 'Test Bank A', popular: true }, { code: 'TESTBANKB', name: 'Test Bank B', popular: true }] });
    if (url.endsWith('/v1/banks/verify')) return json({ accountName: 'TEST ACCOUNT' });
    if (method === 'POST' && url.endsWith('/v1/cashouts')) {
      const validUntil = new Date(Date.now() + 1_800_000).toISOString();
      const tx = buildOneTapTransaction({ router: ROUTER_V2, amountWei: 5000n * 10n ** 18n, route: 0, minOut: 600_000n, deadline: 1n, payTo: '0x000000000000000000000000000000000000dEaD', payAmount: 500_000n, orderId: ID });
      return json({ id: ID, object: 'cashout', mode: 'test', status: 'awaiting_signature', wallet: '0x1', amountG: '5000', receive: QUOTE.receive, feePercent: 1.5, partnerRef: null, txHash: null, expiresAt: validUntil, createdAt: '', updatedAt: '', paidAt: null, fees: QUOTE.fees, transaction: tx, order: { router: ROUTER_V2, payTo: '0x000000000000000000000000000000000000dEaD', payAmount: '500000', amountWei: (5000n * 10n ** 18n).toString(), minOut: '600000', validUntil } }, 201);
    }
    if (url.includes('/simulate')) return json({ id: ID, status: 'sent', receive: QUOTE.receive, txHash: '0x7e57' });
    if (url.endsWith(`/v1/cashouts/${ID}`)) return json({ id: ID, status: status[Math.min(polls++, status.length - 1)], receive: QUOTE.receive });
    throw new Error(`unexpected ${method} ${url}`);
  });
  return { f: f as unknown as typeof fetch, calls };
}

const WALLET = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;
const send = vi.fn(async () => `0x${'ab'.repeat(32)}` as `0x${string}`);

function setup(ui: React.ReactElement, status?: string[]) {
  const api = fakeApi(status);
  render(
    <GoodCashProvider publishableKey={'gc_pk_test_' + 'a'.repeat(32)} fetch={api.f}>
      {ui}
    </GoodCashProvider>
  );
  return api;
}

describe('CashOutFlow', () => {
  it('walks amount -> bank -> review -> paid, showing every fee in plain words', async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    const api = setup(<CashOutFlow signer={send} wallet={WALLET} partnerRef="player-42" onEvent={(e) => events.push(e.type)} />);

    await user.type(screen.getByLabelText('How much G$?'), '5000');
    await screen.findByText('₦781');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(await screen.findByRole('option', { name: 'Test Bank A' }));
    await user.type(screen.getByLabelText('Account number'), '0123456789');
    await screen.findByText('TEST ACCOUNT');
    await user.click(screen.getByRole('button', { name: 'Review' }));

    for (const label of ['GoodDollar contribution (10%)', 'GoodCash fee (1%)', 'Test Game fee (0.5%)', 'Bank payout fee', 'Network fee']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText(/••••6789/)).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/swap|slippage|usdt|paycrest|relay|quote/i);

    await user.click(screen.getByRole('button', { name: 'Confirm cash out' }));
    await screen.findByText(/is in your bank account/, {}, { timeout: 15_000 });
    const create = api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/cashouts'))!;
    expect(create.body).toMatchObject({ wallet: WALLET, amountG: '5000', feePercentShown: 1.5, partnerRef: 'player-42', recipient: { bankCode: 'TESTBANKA', accountNumber: '0123456789', accountName: 'TEST ACCOUNT' } });
    expect(events).toEqual(['cashout.created', 'cashout.sent', 'cashout.paid']);
  }, 30_000);

  it('blocks amounts below the minimum with a plain note', async () => {
    const user = userEvent.setup();
    setup(<CashOutFlow signer={send} wallet={WALLET} />);
    await user.type(screen.getByLabelText('How much G$?'), '10');
    await screen.findByText(/smallest cash out is about 4,700 G\$/);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('CashOutButton dialog', () => {
  it('opens a labelled modal dialog, traps focus, closes on Escape and gives focus back', async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    setup(<CashOutButton signer={send} wallet={WALLET} onEvent={(e) => events.push(e.type)} />);
    const opener = screen.getByRole('button', { name: 'Cash out to bank' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Cash out to your bank');
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(events).toEqual(['closed']);
  });

  it('styles are scoped (every class starts with gcw)', () => {
    const classes = GOODCASH_CSS.match(/\.[a-zA-Z][\w-]*/g) ?? [];
    expect(classes.length).toBeGreaterThan(10);
    expect(classes.every((c) => c.startsWith('.gcw'))).toBe(true);
  });
});
