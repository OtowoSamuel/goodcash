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

import { connectInjectedWallet, friendlyConnectError } from './router';

describe('connecting a wallet', () => {
  const stubWallet = (handler: (method: string) => unknown) => {
    vi.stubGlobal('window', { ethereum: { request: vi.fn(async ({ method }: { method: string }) => handler(method)) } });
  };

  it('is connected as soon as the wallet gives an account, even if it cannot move to Celo', async () => {
    stubWallet((method) => {
      if (method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
      if (method === 'eth_chainId') return '0x1'; // wallet is on Ethereum
      throw Object.assign(new Error('Unrecognized chain'), { code: 4902 }); // can neither switch nor add Celo
    });
    await expect(connectInjectedWallet()).resolves.toBe('0x1111111111111111111111111111111111111111');
    vi.unstubAllGlobals();
  });

  it('still fails clearly when the wallet gives no account', async () => {
    stubWallet((method) => (method === 'eth_requestAccounts' ? [] : '0xa4ec'));
    await expect(connectInjectedWallet()).rejects.toThrow(/No account/);
    vi.unstubAllGlobals();
  });

  it('explains each failure in plain words and never talks about swaps', () => {
    const cases: Array<[unknown, RegExp]> = [
      [Object.assign(new Error('User rejected the request.'), { code: 4001 }), /cancelled/i],
      [Object.assign(new Error("Request of type 'wallet_requestPermissions' already pending"), { code: -32002 }), /request waiting/i],
      [new Error('MetaMask is locked'), /locked/i],
      [new Error('No Celo wallet detected.'), /No wallet found/i],
      [new Error('something odd'), /couldn't connect your wallet/i],
    ];
    for (const [err, expected] of cases) {
      const msg = friendlyConnectError(err);
      expect(msg).toMatch(expected);
      expect(msg).not.toMatch(/swap|nothing was taken/i);
    }
  });
});

import { disconnectInjectedWallet } from './router';

describe('disconnecting a wallet', () => {
  it('asks a browser wallet to forget this site, and does not fail if it cannot', async () => {
    const request = vi.fn().mockResolvedValue(null);
    vi.stubGlobal('window', { ethereum: { request } });
    await disconnectInjectedWallet();
    expect(request).toHaveBeenCalledWith({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });

    vi.stubGlobal('window', { ethereum: { request: vi.fn().mockRejectedValue(new Error('unsupported')) } });
    await expect(disconnectInjectedWallet()).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
