import type { CashOutTransaction, NetworkFeeInfo } from './core';

export type Mode = 'live' | 'test';
export type CashOutStatus = 'awaiting_signature' | 'sent' | 'processing' | 'paid' | 'failed' | 'refunded' | 'expired';

export interface Recipient {
  /** From banks() */
  bankCode: string;
  accountNumber: string;
  /** From verifyAccount(); show it to the customer before they confirm */
  accountName: string;
}

export interface FeeLine {
  type: 'gooddollar_contribution' | 'goodcash_fee' | 'partner_fee' | 'payout_fee' | string;
  /** Plain words, ready to show */
  label: string;
  percent?: number;
  amountG?: string;
  naira?: number;
}

export interface Quote {
  object: 'quote';
  mode: Mode;
  amountG: string;
  receive: { naira: number; minimumNaira: number };
  /** Send this back as feePercentShown when creating the cash out */
  feePercent: number;
  fees: FeeLine[];
  minimumG: number;
  enough: boolean;
  nairaPerDollar: number;
  expiresAt: string;
}

export interface Bank {
  code: string;
  name: string;
  popular: boolean;
}

export interface Limits {
  currency: 'NGN';
  country: 'NG';
  chainId: number;
  minimumG: number;
  maximumG: number;
  feePercent: number;
}

export interface CashOut {
  id: string;
  object: 'cashout';
  mode: Mode;
  status: CashOutStatus;
  wallet: string;
  amountG: string;
  receive: { naira: number; minimumNaira: number };
  feePercent: number;
  partnerRef: string | null;
  txHash: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

export interface CreatedCashOut extends CashOut {
  fees: FeeLine[];
  transaction: CashOutTransaction;
  order: { router: `0x${string}`; payTo: `0x${string}`; payAmount: string; amountWei: string; minOut: string; validUntil: string };
  test?: { note: string };
}

export interface PartnerInfo {
  id: string;
  name: string;
  mode: Mode;
  logoUrl: string | null;
  accentColor: string | null;
  feePercent: number;
}

export interface Page<T> {
  object: 'list';
  data: T[];
  nextCursor: string | null;
}

export type { CashOutTransaction, NetworkFeeInfo };
