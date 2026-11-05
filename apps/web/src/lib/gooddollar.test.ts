/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zeroAddress } from 'viem';

import { ClaimSDK, IdentitySDK } from './goodsdks';

import { useClaim } from './useClaim';

function createWalletClient(address = '0x1111111111111111111111111111111111111111') {
  return {
    account: { address },
    getAddresses: vi.fn().mockResolvedValue([address]),
    signMessage: vi.fn(),
    writeContract: vi.fn(),
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GoodDollar claim hook', () => {
  it('shows the verification state when the user is not whitelisted', async () => {
    const walletClient = createWalletClient();
    const publicClient = {} as any;

    vi.spyOn(IdentitySDK.prototype, 'getWhitelistedRoot').mockResolvedValue({
      isWhitelisted: false,
      root: zeroAddress,
    });
    vi.spyOn(IdentitySDK.prototype, 'generateFVLink').mockResolvedValue(
      'https://verify.gooddollar.org/connect',
    );

    const container = document.createElement('div');
    const root = createRoot(container);
    let hookState: any;

    function TestHarness() {
      hookState = useClaim({
        address: walletClient.account.address,
        walletClient,
        publicClient,
      });
      return null;
    }

    await act(async () => {
      root.render(React.createElement(TestHarness));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(hookState.status).toBe('not_verified');
    expect(hookState.verificationUrl).toBe('https://verify.gooddollar.org/connect');
    root.unmount();
  });

  it('shows the can-claim state when the user has entitlement', async () => {
    const walletClient = createWalletClient();
    const publicClient = {} as any;

    vi.spyOn(IdentitySDK.prototype, 'getWhitelistedRoot').mockResolvedValue({
      isWhitelisted: true,
      root: walletClient.account.address,
    });
    vi.spyOn(ClaimSDK.prototype, 'getWalletClaimStatus').mockResolvedValue({
      status: 'can_claim',
      entitlement: 123n * 10n ** 18n,
    });

    const container = document.createElement('div');
    const root = createRoot(container);
    let hookState: any;

    function TestHarness() {
      hookState = useClaim({
        address: walletClient.account.address,
        walletClient,
        publicClient,
      });
      return null;
    }

    await act(async () => {
      root.render(React.createElement(TestHarness));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(hookState.status).toBe('can_claim');
    expect(hookState.entitlement).toBe(123n * 10n ** 18n);
    root.unmount();
  });

  it('updates after a successful claim and refreshes the next claim time', async () => {
    const walletClient = createWalletClient();
    const publicClient = {} as any;

    vi.spyOn(IdentitySDK.prototype, 'getWhitelistedRoot').mockResolvedValue({
      isWhitelisted: true,
      root: walletClient.account.address,
    });

    const claimStatusSequence = [
      { status: 'can_claim' as const, entitlement: 10n ** 18n },
      { status: 'already_claimed' as const, entitlement: 0n, nextClaimTime: new Date('2025-01-02T00:00:00.000Z') },
    ];

    vi.spyOn(ClaimSDK.prototype, 'getWalletClaimStatus').mockImplementation(async () => {
      const next = claimStatusSequence.shift();
      return next ?? claimStatusSequence[0];
    });
    vi.spyOn(ClaimSDK.prototype, 'claim').mockResolvedValue({ status: 'success' } as any);

    const container = document.createElement('div');
    const root = createRoot(container);
    let hookState: any;

    function TestHarness() {
      hookState = useClaim({
        address: walletClient.account.address,
        walletClient,
        publicClient,
      });
      return null;
    }

    await act(async () => {
      root.render(React.createElement(TestHarness));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(hookState.status).toBe('can_claim');

    const result = await act(async () => {
      return hookState.claim();
    });

    expect(result.status).toBe('claimed');
    expect(hookState.status).toBe('already_claimed');
    expect(hookState.nextClaimTime).toEqual(new Date('2025-01-02T00:00:00.000Z'));
    root.unmount();
  });
});
