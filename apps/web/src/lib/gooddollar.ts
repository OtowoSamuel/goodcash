/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ClaimSDK,
  IdentitySDK,
  SupportedChains,
  checkGenericDailyStats,
  checkGenericEntitlement,
} from './goodsdks';
import {
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
  zeroAddress,
} from 'viem';

export type GoodDollarClaimStatus =
  | 'idle'
  | 'loading'
  | 'can_claim'
  | 'already_claimed'
  | 'not_verified'
  | 'error';

export interface GoodDollarClientConfig {
  publicClient: PublicClient;
  walletClient?: WalletClient<any, Chain | undefined, Account | undefined>;
  address?: Address;
  env?: 'production' | 'staging' | 'development';
  callbackUrl?: string;
}

export interface GoodDollarClaimState {
  status: GoodDollarClaimStatus;
  entitlement: bigint;
  nextClaimTime: Date | null;
  verificationUrl: string | null;
  error: string | null;
}

export function getDefaultGoodDollarCallbackUrl(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return `${window.location.origin}${window.location.pathname}`;
}

export function createIdentitySDK({
  publicClient,
  walletClient,
  env = 'production',
}: Pick<GoodDollarClientConfig, 'publicClient' | 'walletClient' | 'env'>): IdentitySDK {
  const fallbackWallet = walletClient ?? ({
    account: { address: zeroAddress },
    getAddresses: async () => [zeroAddress],
  } as unknown as WalletClient<any, Chain | undefined, Account | undefined>);

  return new IdentitySDK(publicClient, fallbackWallet, env);
}

export function createClaimSDK({
  publicClient,
  walletClient,
  address,
  env = 'production',
}: GoodDollarClientConfig): ClaimSDK {
  if (!walletClient) {
    throw new Error('A wallet client is required to create a claim SDK instance.');
  }

  const resolvedAddress = address ?? walletClient.account?.address;
  if (!resolvedAddress) {
    throw new Error('A wallet address is required to create a claim SDK instance.');
  }

  return new ClaimSDK({
    account: resolvedAddress,
    publicClient,
    walletClient,
    identitySDK: createIdentitySDK({ publicClient, walletClient, env }),
    env,
  });
}

export async function isVerified(
  address: Address,
  config: Pick<GoodDollarClientConfig, 'publicClient' | 'walletClient' | 'env'>,
): Promise<boolean> {
  const identitySDK = createIdentitySDK(config);
  const { isWhitelisted } = await identitySDK.getWhitelistedRoot(address);
  return isWhitelisted;
}

export async function getEntitlement(
  address: Address,
  config: Pick<GoodDollarClientConfig, 'publicClient' | 'walletClient' | 'env'>,
): Promise<bigint> {
  const walletClient = config.walletClient;
  if (walletClient && address === walletClient.account?.address) {
    const claimSDK = createClaimSDK({
      ...config,
      address,
    });
    return (await claimSDK.checkEntitlement()).amount;
  }

  return checkGenericEntitlement({
    publicClient: config.publicClient,
    chainId: SupportedChains.CELO,
    env: config.env ?? 'production',
  });
}

export async function getNextClaimTime(
  address: Address,
  config: Pick<GoodDollarClientConfig, 'publicClient' | 'walletClient' | 'env'>,
): Promise<Date | null> {
  const walletClient = config.walletClient;
  if (!walletClient) {
    return null;
  }

  const claimSDK = createClaimSDK({
    ...config,
    address,
  });
  return claimSDK.nextClaimTime();
}

export async function getDailyStats(
  config: Pick<GoodDollarClientConfig, 'publicClient' | 'env'>,
): Promise<{ claimers: bigint; amount: bigint }> {
  const publicClient = config.publicClient;
  const env = config.env ?? 'production';

  return checkGenericDailyStats({
    publicClient,
    chainId: SupportedChains.CELO,
    env,
  });
}

export async function generateVerificationUrl(
  config: GoodDollarClientConfig,
): Promise<string | null> {
  if (!config.walletClient) {
    return null;
  }

  const address = config.address ?? config.walletClient.account?.address;
  if (!address) {
    return null;
  }

  const identitySDK = createIdentitySDK({
    publicClient: config.publicClient,
    walletClient: config.walletClient,
    env: config.env,
  });

  return identitySDK.generateFVLink(
    false,
    config.callbackUrl ?? getDefaultGoodDollarCallbackUrl() ?? undefined,
    SupportedChains.CELO,
  );
}

export async function getClaimStatus(
  config: GoodDollarClientConfig,
): Promise<GoodDollarClaimState> {
  const address = config.address ?? config.walletClient?.account?.address;
  if (!address) {
    return {
      status: 'idle',
      entitlement: 0n,
      nextClaimTime: null,
      verificationUrl: null,
      error: null,
    };
  }

  try {
    const isVerifiedState = await isVerified(address, config);
    if (!isVerifiedState) {
      const verificationUrl = await generateVerificationUrl(config);
      return {
        status: 'not_verified',
        entitlement: 0n,
        nextClaimTime: null,
        verificationUrl,
        error: null,
      };
    }

    if (!config.walletClient) {
      return {
        status: 'idle',
        entitlement: 0n,
        nextClaimTime: null,
        verificationUrl: null,
        error: null,
      };
    }

    const claimSDK = createClaimSDK(config);
    const status = await claimSDK.getWalletClaimStatus();

    if (status.status === 'can_claim') {
      return {
        status: 'can_claim',
        entitlement: status.entitlement,
        nextClaimTime: null,
        verificationUrl: null,
        error: null,
      };
    }

    if (status.status === 'already_claimed') {
      return {
        status: 'already_claimed',
        entitlement: 0n,
        nextClaimTime: status.nextClaimTime ?? null,
        verificationUrl: null,
        error: null,
      };
    }

    return {
      status: 'not_verified',
      entitlement: 0n,
      nextClaimTime: null,
      verificationUrl: await generateVerificationUrl(config),
      error: null,
    };
  } catch (error) {
    return {
      status: 'error',
      entitlement: 0n,
      nextClaimTime: null,
      verificationUrl: null,
      error: error instanceof Error ? error.message : 'Unable to read GoodDollar claim status.',
    };
  }
}

export async function claimGoodDollar(
  config: GoodDollarClientConfig,
): Promise<{ status: 'claimed'; receipt: unknown } | { status: 'rejected'; message: string }> {
  const address = config.address ?? config.walletClient?.account?.address;
  if (!address || !config.walletClient) {
    return {
      status: 'rejected',
      message: 'A connected wallet is required to claim G$.',
    };
  }

  try {
    const claimSDK = createClaimSDK(config);
    const receipt = await claimSDK.claim();
    return { status: 'claimed', receipt };
  } catch (error) {
    return {
      status: 'rejected',
      message: error instanceof Error ? error.message : 'Claim failed.',
    };
  }
}
