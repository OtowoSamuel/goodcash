/**
 * useOffRamp — client hook for Paycrest off-ramp order flow.
 *
 * Flow:
 *   1. `createOrder(input)` — POST to the backend Worker, receive receiveAddress + amountToSend.
 *   2. User sends USDT from their own wallet to receiveAddress.
 *   3. `poll(orderId)` — GET /orders/:id, update status display.
 *   4. Status transitions: initiated → deposited → pending → fulfilling → settled.
 *   5. On expiry, call `renewOrder()` to create a fresh order (never reuse an address).
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Order status union (all Paycrest statuses)
// ---------------------------------------------------------------------------
export type OffRampStatus =
  | 'idle'
  | 'creating'
  | 'initiated'
  | 'deposited'
  | 'pending'
  | 'fulfilling'
  | 'validated'
  | 'settling'
  | 'settled'
  | 'expired'
  | 'refunding'
  | 'refunded'
  | 'error';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface BankRecipient {
  institution: string;      // e.g. "GTBINGLA" (SWIFT / bank code)
  accountIdentifier: string; // account number or phone
  accountName: string;
  memo?: string;
}

export interface BankInstitution {
  name: string;
  code: string;
  type: string;
}

export interface CreateOrderInput {
  /** USDT amount sent to Paycrest, excluding Paycrest fees */
  amountUsdt: string;
  /** Actual USDT produced by the confirmed swap; the order may never exceed it */
  usdtReceived: number;
  /** Confirmed swap transaction that produced the USDT */
  swapTxHash: string;
  /** User's Celo wallet (refund address if order fails) */
  refundAddress: string;
  recipient: BankRecipient;
}

/**
 * Paycrest docs: `providerAccount.amountToTransfer = amount + senderFee +
 * transactionFee`. With the GoodCash sender fee fixed at zero, reserve the
 * documented transaction fee so the user never has to send more than the
 * swap produced.
 */
export const PAYCREST_FEE_RESERVE_USDT = 0.01;
export const PAYCREST_MIN_ORDER_USDT = 0.5;
const MAX_FEE_OVERFLOW_ATTEMPTS = 3;
const ONE_USDT_ATOMIC = 1_000_000;

export function paycrestOrderAmount(usdtReceived: number): string {
  if (!Number.isFinite(usdtReceived) || usdtReceived <= 0) return '0.000000';
  const atomic = Math.floor((usdtReceived - PAYCREST_FEE_RESERVE_USDT) * ONE_USDT_ATOMIC);
  return (Math.max(0, atomic) / ONE_USDT_ATOMIC).toFixed(6);
}

function toAtomic6(value: number | string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * ONE_USDT_ATOMIC) : Number.NaN;
}

function fromAtomic6(value: number): string {
  return (value / ONE_USDT_ATOMIC).toFixed(6);
}

export interface OffRampOrder {
  orderId: string;
  receiveAddress: string;
  /** Exact amount to send — computed by Paycrest, includes fees */
  amountToSend: string;
  currency: string;
  network: string;
  memo?: string;
  /** Paycrest order amount before fees, when returned by the API */
  amount?: string;
  /** Paycrest quoted fiat-per-crypto rate, when returned by the API */
  rate?: string;
  /** amount × rate from the Paycrest order response */
  expectedNaira?: string;
  senderFee: string;
  transactionFee: string;
  validUntil: string;
  status: OffRampStatus;
  paymentReference?: string | null;
}

export interface UseOffRampReturn {
  order: OffRampOrder | null;
  status: OffRampStatus;
  error: string | null;
  createOrder: (input: CreateOrderInput) => Promise<void>;
  pollOnce: () => Promise<void>;
  renewOrder: (input: CreateOrderInput) => Promise<void>;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
const TERMINAL_STATUSES: OffRampStatus[] = ['settled', 'refunded', 'error'];
const EXPIRED_STATUSES: OffRampStatus[] = ['expired'];

export function isTerminalStatus(s: OffRampStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}

export function isExpiredStatus(s: OffRampStatus): boolean {
  return EXPIRED_STATUSES.includes(s);
}

export function offRampStatusLabel(s: OffRampStatus): string {
  const labels: Record<OffRampStatus, string> = {
    idle: 'Waiting to start',
    creating: 'Creating order…',
    initiated: 'Awaiting your USDT deposit',
    deposited: 'Deposit received — processing',
    pending: 'Processing your transfer',
    fulfilling: 'Fulfilling naira payout',
    validated: 'Payout confirmed by provider',
    settling: 'Finalising settlement',
    settled: '✓ Naira delivered successfully',
    expired: 'Order expired — please create a new one',
    refunding: 'Refund in progress',
    refunded: 'USDT refunded to your wallet',
    error: 'An error occurred',
  };
  return labels[s] ?? s;
}

// ---------------------------------------------------------------------------
// Orders endpoint — always call the backend Worker, never Paycrest directly.
// Set VITE_ORDERS_API_URL in .env to your deployed Worker URL.
// Falls back to localhost:8787 for local dev.
// ---------------------------------------------------------------------------
const ORDERS_BASE = (
  typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_ORDERS_API_URL?: string } }).env?.VITE_ORDERS_API_URL
) ?? 'http://localhost:8787';

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ORDERS_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ORDERS_BASE}${path}`);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data;
}

export async function fetchInstitutions(currency = 'NGN'): Promise<BankInstitution[]> {
  const data = await apiGet<{ institutions: BankInstitution[] }>(`/institutions/${currency}`);
  return Array.isArray(data.institutions) ? data.institutions : [];
}

export async function verifyPaycrestAccount(
  institution: string,
  accountIdentifier: string
): Promise<string> {
  const data = await apiPost<{ accountName: string }>('/verify-account', {
    institution,
    accountIdentifier,
  });
  if (!data.accountName) {
    throw new Error('Account name could not be resolved');
  }
  return data.accountName;
}

interface PaycrestOrderPayload {
  orderId: string;
  receiveAddress: string;
  amountToSend: string;
  currency: string;
  network: string;
  memo?: string;
  amount?: string;
  rate?: string;
  expectedNaira?: string;
  senderFee: string;
  transactionFee: string;
  validUntil: string;
  status: string;
  paymentReference?: string | null;
}

export async function createPaycrestOrder(input: CreateOrderInput): Promise<OffRampOrder> {
  const receivedAtomic = toAtomic6(input.usdtReceived);
  if (!Number.isFinite(receivedAtomic) || receivedAtomic <= 0) {
    throw new Error('Invalid swap output amount');
  }

  let amountAtomic = toAtomic6(input.amountUsdt);
  if (!Number.isFinite(amountAtomic) || amountAtomic <= 0) {
    throw new Error('Invalid payout amount');
  }

  const minAtomic = toAtomic6(PAYCREST_MIN_ORDER_USDT);
  let lastAmountToSend = '';

  for (let attempt = 0; attempt < MAX_FEE_OVERFLOW_ATTEMPTS; attempt += 1) {
    let data: PaycrestOrderPayload;
    try {
      data = await apiPost<PaycrestOrderPayload>('/orders', {
        amount: fromAtomic6(amountAtomic),
        swapTxHash: input.swapTxHash,
        refundAddress: input.refundAddress,
        recipient: input.recipient,
      });
    } catch (error: unknown) {
      if (attempt === 0) throw error;
      const message = error instanceof Error ? error.message : 'Order creation failed';
      throw new Error(
        `Paycrest fees exceed the swapped USDT and the reduced order could not be created: ${message}`
      );
    }

    const order: OffRampOrder = {
      ...data,
      status: (data.status as OffRampStatus) ?? 'initiated',
    };

    const toSendAtomic = toAtomic6(order.amountToSend);
    if (!Number.isFinite(toSendAtomic) || toSendAtomic <= 0) {
      throw new Error('Paycrest returned an invalid amountToSend');
    }

    if (toSendAtomic <= receivedAtomic) {
      return order;
    }

    lastAmountToSend = order.amountToSend;
    const overflowAtomic = toSendAtomic - receivedAtomic;
    const nextAtomic = amountAtomic - overflowAtomic - 1;

    if (nextAtomic < minAtomic) {
      throw new Error(
        `Paycrest fees exceed the swapped USDT: the order requires ${lastAmountToSend} USDT but the swap produced ${input.usdtReceived.toFixed(6)} USDT, and reducing the payout would fall below the $${PAYCREST_MIN_ORDER_USDT.toFixed(2)} minimum. Please retry with a larger swap.`
      );
    }

    amountAtomic = nextAtomic;
  }

  throw new Error(
    `Paycrest fees still exceed the swapped USDT after ${MAX_FEE_OVERFLOW_ATTEMPTS} attempts (last order required ${lastAmountToSend} USDT). Please retry.`
  );
}

export async function fetchOrderStatus(orderId: string): Promise<OffRampOrder> {
  const data = await apiGet<{
    orderId: string;
    status: string;
    receiveAddress?: string;
    amountToSend?: string;
    validUntil?: string;
    paymentReference?: string | null;
  }>(`/orders/${orderId}`);

  return {
    orderId: data.orderId,
    receiveAddress: data.receiveAddress ?? '',
    amountToSend: data.amountToSend ?? '',
    currency: 'USDT',
    network: 'celo',
    senderFee: '0',
    transactionFee: '0',
    validUntil: data.validUntil ?? '',
    status: (data.status as OffRampStatus) ?? 'initiated',
    paymentReference: data.paymentReference,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useOffRamp(): UseOffRampReturn {
  const [order, setOrder] = useState<OffRampOrder | null>(null);
  const [status, setStatus] = useState<OffRampStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const lastInputRef = useRef<CreateOrderInput | null>(null);

  const createOrder = useCallback(async (input: CreateOrderInput) => {
    setStatus('creating');
    setError(null);
    lastInputRef.current = input;

    try {
      const newOrder = await createPaycrestOrder(input);
      setOrder(newOrder);
      setStatus(newOrder.status);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create order';
      setOrder(null);
      setError(msg);
      setStatus('error');
      throw e;
    }
  }, []);

  const pollOnce = useCallback(async () => {
    if (!order?.orderId) return;
    if (status === 'settled' || status === 'refunded' || status === 'expired' || status === 'error') return;

    try {
      const data = await apiGet<{
        orderId: string;
        status: string;
        receiveAddress?: string;
        amountToSend?: string;
        validUntil?: string;
        paymentReference?: string | null;
      }>(`/orders/${order.orderId}`);

      const newStatus = (data.status as OffRampStatus) ?? status;
      setOrder((prev) => prev ? {
        ...prev,
        status: newStatus,
        paymentReference: data.paymentReference ?? prev.paymentReference,
      } : prev);
      setStatus(newStatus);
    } catch (e) {
      // Polling failure is non-fatal — just log it
      console.warn('[useOffRamp] Poll failed:', e);
    }
  }, [order, status]);

  /**
   * Create a fresh order after the previous one expired.
   * Never reuse an old `receiveAddress`.
   */
  const renewOrder = useCallback(async (input: CreateOrderInput) => {
    setOrder(null);
    await createOrder(input);
  }, [createOrder]);

  const reset = useCallback(() => {
    setOrder(null);
    setStatus('idle');
    setError(null);
    lastInputRef.current = null;
  }, []);

  return { order, status, error, createOrder, pollOnce, renewOrder, reset };
}

export type AccountVerificationStatus = 'idle' | 'loading' | 'verified' | 'error';

export interface BankAccountVerification {
  institutions: BankInstitution[];
  institutionsLoading: boolean;
  institutionsError: string | null;
  institutionCode: string;
  setInstitutionCode: (code: string) => void;
  selectedInstitution: BankInstitution | null;
  accountIdentifier: string;
  setAccountIdentifier: (value: string) => void;
  accountName: string | null;
  verificationStatus: AccountVerificationStatus;
  verificationError: string | null;
  confirmed: boolean;
  setConfirmed: (confirmed: boolean) => void;
}

/**
 * Loads Paycrest's institution list and verifies the account name whenever
 * both the institution code and a 10-digit NGN account number are present.
 */
export function useBankAccountVerification(currency = 'NGN'): BankAccountVerification {
  const [institutions, setInstitutions] = useState<BankInstitution[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(true);
  const [institutionsError, setInstitutionsError] = useState<string | null>(null);
  const [institutionCode, setInstitutionCode] = useState('');
  const [accountIdentifier, setAccountIdentifierState] = useState('');
  const [accountName, setAccountName] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<AccountVerificationStatus>('idle');
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInstitutionsLoading(true);
    fetchInstitutions(currency)
      .then((list) => {
        if (cancelled) return;
        setInstitutions(list);
        setInstitutionsError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setInstitutionsError(e instanceof Error ? e.message : 'Could not load banks');
      })
      .finally(() => {
        if (!cancelled) setInstitutionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currency]);

  const setAccountIdentifier = useCallback((value: string) => {
    setAccountIdentifierState(value.replace(/\D/g, '').slice(0, 10));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAccountName(null);
    setConfirmed(false);

    if (!institutionCode || accountIdentifier.length !== 10) {
      setVerificationStatus('idle');
      setVerificationError(null);
      return;
    }

    setVerificationStatus('loading');
    setVerificationError(null);

    const timer = setTimeout(() => {
      verifyPaycrestAccount(institutionCode, accountIdentifier)
        .then((name) => {
          if (cancelled) return;
          setAccountName(name);
          setVerificationStatus('verified');
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setVerificationStatus('error');
          setVerificationError(e instanceof Error ? e.message : 'Could not verify account');
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [institutionCode, accountIdentifier]);

  const selectedInstitution =
    institutions.find((institution) => institution.code === institutionCode) ?? null;

  return {
    institutions,
    institutionsLoading,
    institutionsError,
    institutionCode,
    setInstitutionCode,
    selectedInstitution,
    accountIdentifier,
    setAccountIdentifier,
    accountName,
    verificationStatus,
    verificationError,
    confirmed,
    setConfirmed,
  };
}
