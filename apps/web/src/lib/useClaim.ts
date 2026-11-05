/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react';
import type { Account, Address, Chain, PublicClient, WalletClient } from 'viem';

import {
  type GoodDollarClaimState,
  claimGoodDollar,
  getClaimStatus,
} from './gooddollar';

export interface UseClaimOptions {
  publicClient: PublicClient;
  walletClient?: WalletClient<any, Chain | undefined, Account | undefined>;
  address?: Address;
  env?: 'production' | 'staging' | 'development';
  callbackUrl?: string;
}

export type ClaimHookState = GoodDollarClaimState & {
  isLoading: boolean;
  isClaiming: boolean;
};

const initialState: ClaimHookState = {
  status: 'idle',
  entitlement: 0n,
  nextClaimTime: null,
  verificationUrl: null,
  error: null,
  isLoading: false,
  isClaiming: false,
};

export function useClaim(options: UseClaimOptions) {
  const [state, setState] = useState<ClaimHookState>(initialState);

  const refresh = useCallback(async () => {
    const address = options.address ?? options.walletClient?.account?.address;
    if (!address) {
      setState({ ...initialState, status: 'idle' });
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const nextState = await getClaimStatus({
        publicClient: options.publicClient,
        walletClient: options.walletClient,
        address,
        env: options.env,
        callbackUrl: options.callbackUrl,
      });

      setState({
        ...nextState,
        isLoading: false,
        isClaiming: false,
      });
    } catch (error) {
      setState({
        ...initialState,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unable to refresh claim state.',
        isLoading: false,
        isClaiming: false,
      });
    }
  }, [options.address, options.callbackUrl, options.env, options.publicClient, options.walletClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const claim = useCallback(async () => {
    const address = options.address ?? options.walletClient?.account?.address;
    if (!address || !options.walletClient) {
      setState({
        ...initialState,
        status: 'error',
        error: 'A connected wallet is required to claim G$.',
      });
      return { status: 'rejected', message: 'A connected wallet is required to claim G$.' };
    }

    setState((prev) => ({ ...prev, isClaiming: true, error: null }));

    try {
      const result = await claimGoodDollar({
        publicClient: options.publicClient,
        walletClient: options.walletClient,
        address,
        env: options.env,
        callbackUrl: options.callbackUrl,
      });

      if (result.status === 'rejected') {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: result.message,
          isClaiming: false,
        }));
        return result;
      }

      await refresh();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Claim failed.';
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: message,
        isClaiming: false,
      }));
      return { status: 'rejected', message };
    }
  }, [options.address, options.callbackUrl, options.env, options.publicClient, options.walletClient, refresh]);

  return {
    ...state,
    verificationUrl: state.verificationUrl,
    refresh,
    claim,
    canClaim: state.status === 'can_claim',
  };
}
