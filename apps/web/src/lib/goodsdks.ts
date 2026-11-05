/* eslint-disable @typescript-eslint/no-explicit-any */
export const SupportedChains = {
  CELO: 42220,
  FUSE: 122,
  XDC: 50,
} as const;

export class IdentitySDK {
  constructor(..._args: any[]) {}

  public static async init(..._args: any[]): Promise<IdentitySDK> {
    return new IdentitySDK();
  }

  async getWhitelistedRoot(..._args: any[]): Promise<{ isWhitelisted: boolean; root: `0x${string}` }> {
    return { isWhitelisted: false, root: '0x0000000000000000000000000000000000000000' as `0x${string}` };
  }

  async generateFVLink(..._args: any[]): Promise<string> {
    return 'https://verify.gooddollar.org/connect';
  }
}

export class ClaimSDK {
  constructor(..._args: any[]) {}

  public static async init(..._args: any[]): Promise<ClaimSDK> {
    return new ClaimSDK();
  }

  async checkEntitlement(..._args: any[]): Promise<{ amount: bigint; altClaimAvailable: boolean; altChainId: number | null; altAmount: bigint | null }> {
    return { amount: 0n, altClaimAvailable: false, altChainId: null, altAmount: null };
  }

  async getWalletClaimStatus(..._args: any[]): Promise<{ status: 'not_whitelisted' | 'can_claim' | 'already_claimed'; entitlement: bigint; nextClaimTime?: Date }> {
    return { status: 'already_claimed', entitlement: 0n, nextClaimTime: new Date(0) };
  }

  async nextClaimTime(..._args: any[]): Promise<Date> {
    return new Date(0);
  }

  async claim(..._args: any[]): Promise<unknown> {
    return { status: 'success' };
  }
}

export async function checkGenericEntitlement(..._args: any[]): Promise<bigint> {
  return 0n;
}

export async function checkGenericDailyStats(..._args: any[]): Promise<{ claimers: bigint; amount: bigint }> {
  return { claimers: 0n, amount: 0n };
}
