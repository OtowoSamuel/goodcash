/** Shared types for the partner API (/v1). */
import type { Env, PaycrestInstitution } from '../index';

export type KeyKind = 'pk' | 'sk';
export type Mode = 'live' | 'test';

/** What is stored at `partner:<id>`. Keys are stored separately, as hashes only. */
export interface Partner {
  id: string;
  name: string;
  enabled: boolean;
  /** Exact browser origins allowed to use the publishable key, e.g. "https://game.example" */
  allowedOrigins: string[];
  /** App ids (sent as X-GoodCash-App) allowed to use the publishable key from native apps and WebViews */
  appIds: string[];
  /** The partner's own fee on top of GoodCash's, in percent (0 to 3) */
  feePercent: number;
  /** Shown in the widget */
  logoUrl?: string;
  accentColor?: string;
  /** Where partner webhooks go, per mode */
  webhookUrl?: { live?: string; test?: string };
  /** The webhook signing secret per mode, encrypted with PARTNER_SECRETS_KEY (AES-GCM, base64 "iv.cipher") */
  webhookSecretEnc?: { live?: string; test?: string };
  createdAt: number;
  /** Set for partners who signed up themselves (test keys only until GoodCash approves live) */
  selfServe?: boolean;
  /** Where to reach a self-serve partner (their sign-up email) */
  contactEmail?: string;
  /** When a self-serve partner last asked for live keys */
  liveRequestedAt?: number;
  /** GoodCash has switched naira-in (top-ups) on for this partner in LIVE mode (test mode needs no switch) */
  topupEnabled?: boolean;
}

export type TopUpAsset = 'g' | 'celo';
export type TopUpStatus = 'awaiting_payment' | 'paid_in' | 'delivered' | 'failed' | 'expired';

/** A top-up through the partner API, stored at `pt:<id>`. Never holds ID details or bank details. */
export interface TopUpRecord {
  id: string;
  partnerId: string;
  mode: Mode;
  wallet: string;
  naira: number;
  asset: TopUpAsset;
  /** Live: the payout partner's order id (the customer's ID details went there directly, never through us) */
  orderId?: string;
  status: TopUpStatus;
  partnerRef?: string;
  txHash?: string;
  createdAt: number;
  updatedAt: number;
  deliveredAt?: number;
}

/** What is stored at `key:<sha256 of the key>`. */
export interface KeyRecord {
  partnerId: string;
  kind: KeyKind;
  mode: Mode;
  createdAt: number;
}

export interface AuthContext {
  partner: Partner;
  kind: KeyKind;
  mode: Mode;
  /** The browser origin this request may be answered to (publishable key from an allowed site), else null */
  corsOrigin: string | null;
}

/** A cash out made through the partner API, stored at `pc:<id>`. Never holds bank details. */
export interface CashOutRecord {
  id: string;
  partnerId: string;
  mode: Mode;
  wallet: string;
  amountG: string;
  amountWei: string;
  router: string;
  payTo: string;
  /** Exact USDT (6 decimals) the router pays the payout address */
  payAmount: string;
  minOut: string;
  validUntil: string;
  /** Expected naira (from the order) and the guaranteed-minimum naira */
  naira: number;
  minimumNaira: number;
  feePercent: number;
  goodcashFeePercent: number;
  partnerFeePercent: number;
  partnerRef?: string;
  /** Live: dollars (USDT) paid out to the bank for this order, and whether the payout partner accepted our fee setting */
  orderAmountUsdt?: string;
  feeCharged?: boolean;
  txHash?: string;
  sentAt?: number;
  /** Last status we saw, ours (plain) */
  status: string;
  /** Test mode only: last 10 digits of the account, to pick the simulated outcome. Never stored in live mode. */
  testOutcome?: 'paid' | 'failed' | 'refunded' | 'delayed';
  createdAt: number;
  updatedAt: number;
  paidAt?: number;
}

/** Functions from the main worker the partner API reuses, so both share one implementation. */
export interface V1Deps {
  rpcCall(env: Env, method: string, params: unknown[]): Promise<unknown>;
  generateRef(prefix?: string): string;
  lookupOrderStatus(orderId: string, env: Env): Promise<string | null>;
  goodcashFeePercent(env: Env): number;
  fetchNgnRate(env: Env): Promise<number | null>;
  createSizedOneTapOrder(
    env: Env,
    input: {
      minUsdtAtomic: bigint;
      refundAddress: string;
      recipient: { institution: string; accountIdentifier: string; accountName: string; memo?: string };
      reference: string;
      feePercentOverride?: number;
    }
  ): Promise<
    | { order: { id: string; amount?: string; rate?: string; senderFee?: string; providerAccount: { receiveAddress: string; amountToTransfer: string; validUntil: string } }; receive: string; payAmountAtomic: bigint }
    | { response: Response; reason?: 'amount_too_small' }
  >;
  linkOneTapSwap(orderId: string, txHash: string, wallet: string, env: Env): Promise<{ ok: true } | { pending: true } | { error: string; status: number; reason: string }>;
  verifyAccountName(
    input: { institution: string; accountIdentifier: string },
    env: Env
  ): Promise<{ accountName: string; message: string } | { error: string; status: number; reason: 'not_found' | 'unavailable' }>;
  cachedInstitutionList(env: Env): Promise<PaycrestInstitution[] | null>;
  clientIp(request: Request): string;
  /** The price of a naira-in top-up (the same one the GoodCash app shows) */
  onrampQuote(
    env: Env,
    input: { naira: number; asset: TopUpAsset; wallet: string }
  ): Promise<
    | { amountOut: number; amountOutMin: number; partnerFeeUsd: number; swapFeeUsd: number; minNaira: number; validForSeconds: number }
    | { error: string; status: number }
  >;
  /** What we recorded when the order was created: wallet, naira, asset (never ID details) */
  onrampOrderMeta(env: Env, orderId: string): Promise<{ wallet: string; naira: number; asset: TopUpAsset } | null>;
  /** Where the naira-in order is at the payout partner; null when it cannot be reached right now */
  onrampOrderStatus(env: Env, orderId: string): Promise<{ stage: string; arrived: boolean; txHash?: string } | null>;
}

export type { Env };
