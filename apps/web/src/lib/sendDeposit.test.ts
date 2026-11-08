// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sendUsdtDeposit } from './router';

const FROM = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
const TO = '0x1111111111111111111111111111111111111111';

describe('sendUsdtDeposit guards', () => {
  it('rejects a malformed deposit address', async () => {
    await expect(sendUsdtDeposit({ from: FROM, to: '0x123', amount: '0.5', maxAmount: 0.57 })).rejects.toThrow(/address/i);
  });
  it('rejects zero or invalid amounts', async () => {
    await expect(sendUsdtDeposit({ from: FROM, to: TO, amount: '0', maxAmount: 0.57 })).rejects.toThrow(/amount/i);
    await expect(sendUsdtDeposit({ from: FROM, to: TO, amount: 'abc', maxAmount: 0.57 })).rejects.toThrow(/amount/i);
  });
  it('never sends more than the swap produced', async () => {
    await expect(sendUsdtDeposit({ from: FROM, to: TO, amount: '2.0', maxAmount: 0.57 })).rejects.toThrow(/higher than your swap/i);
  });
});

describe('never pays the stand-in address', () => {
  it('refuses the placeholder shown while a reopened order is still loading', async () => {
    await expect(
      sendUsdtDeposit({ from: FROM, to: '0x3841D6A1F3E92B710c0e5a953eB684B24B35fC75', amount: '0.5', maxAmount: 0.57 })
    ).rejects.toThrow(/still loading/i);
  });
});

import { vi } from 'vitest';
import { friendlyPayError, friendlySwapError, DepositPendingError, SwapPendingError } from './router';

describe('never says "nothing was taken" when money may have moved', () => {
  it('a sent-but-unconfirmed payment tells the user not to pay again', () => {
    const msg = friendlyPayError(new DepositPendingError('0x' + 'ab'.repeat(32)));
    expect(msg).toMatch(/don't pay again/i);
    expect(msg).not.toMatch(/nothing was taken/i);
  });
  it('a sent-but-unconfirmed swap tells the user not to swap again', () => {
    const msg = friendlySwapError(new SwapPendingError('0x' + 'cd'.repeat(32)));
    expect(msg).toMatch(/don't swap again/i);
  });
  it('the generic payment error no longer promises that nothing was taken', () => {
    expect(friendlyPayError(new Error('boom'))).not.toMatch(/nothing was taken/i);
  });
});

describe('re-checks the order right before paying', () => {
  it('stops without touching the wallet when the order can no longer be paid', async () => {
    vi.stubGlobal('window', { ethereum: { request: vi.fn() } });
    const request = (globalThis as unknown as { window: { ethereum: { request: ReturnType<typeof vi.fn> } } }).window.ethereum.request;
    await expect(
      sendUsdtDeposit({
        from: FROM,
        to: TO,
        amount: '0.5',
        maxAmount: 0.57,
        orderId: '11111111-1111-4111-8111-111111111111',
        checkOrder: async () => {
          throw new Error('ORDER_EXPIRED');
        },
      })
    ).rejects.toThrow(/ORDER_EXPIRED/);
    expect(request).not.toHaveBeenCalled();
    expect(friendlyPayError(new Error('ORDER_ALREADY_PAID'))).toMatch(/already received/i);
    vi.unstubAllGlobals();
  });
});
