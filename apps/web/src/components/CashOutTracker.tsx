import { isPaidOutStatus } from '../lib/useOffRamp';
import { nairaFromUsdt } from '../lib/units';
import { friendlyPayError, hasInjectedWallet, PLACEHOLDER_DEPOSIT_ADDRESS } from '../lib/router';
import { getWalletLink, openWalletApp } from '../lib/walletLink';
import { reportIssue } from '../lib/diag';
import { ORDERS_API_BASE } from '../lib/rate';
import { SupportModal } from './SupportModal';
import React, { useState, useEffect, useRef } from 'react';
import type { Language } from '../lib/i18n';
import { getTranslations } from '../lib/i18n';

import {
  useOffRamp,
  paycrestOrderAmount,
  fetchOrderDetails,
  fetchOrderStatus,
  type OffRampOrder,
  type OffRampStatus,
} from '../lib/useOffRamp';

/** Plain words for where a payout is, from the partner's status. Never shows partner or token names. */
function payoutStageText(status?: string): string {
  switch (status) {
    case 'initiated':
      return "We haven't seen your payment yet. It can take a minute or two to show up after you send it.";
    case 'deposited':
    case 'pending':
      return 'We have your payment. Your bank payout is being arranged.';
    case 'fulfilling':
      return 'Your bank is being paid now. Banks can take a few minutes to show it.';
    case 'fulfilled':
    case 'validated':
    case 'settling':
    case 'settled':
      return 'Your naira has been sent to your bank.';
    default:
      return 'We have your payment. Your bank is being paid now.';
  }
}

export interface CashOutTrackerProps {
  // Swap execution info
  txHash: string;
  usdtReceived: number;
  amountGSwapped: number;
  residualBalanceG?: number;
  residualBalanceUsdt?: number;

  // Bank recipient info (from Cash out screen)
  bankName: string;
  accountNumber: string;
  accountHolderName: string;

  // Rate & currency estimates
  ngnPerUsdt?: number | null;
  estimatedNaira?: number;

  // Wallet
  walletAddress: string;

  // Testing & state overrides
  initialOrder?: Partial<OffRampOrder> | null;
  /** When the wallet is connected: sends the exact USDT deposit in one tap. */
  onSendDeposit?: (to: string, amount: string, orderId: string) => Promise<void>;
  /** The app already paid the partner automatically */
  depositSent?: boolean;
  initialStep?: 1 | 2 | 3 | 4;
  initialFailureState?: 'expired' | 'refunded' | 'delayed' | null;
  delayedTimeoutMinutes?: number;

  // Callbacks
  onDone: () => void;
  onCancel?: () => void;
  /** The payment window closed (or the order can't be paid): leave so a fresh payout can be offered. */
  onOrderClosed?: () => void;
  onSettled?: (info: { orderId: string; nairaAmount: number | null }) => void;
  language?: Language;
}


const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  style: { flex: 'none' },
};
const RefreshIcon = () => (
  <svg {...iconProps}><path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4" /></svg>
);
const WarnIcon = () => (
  <svg {...iconProps}><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4M12 17.5v.01" /></svg>
);
const UndoIcon = () => (
  <svg {...iconProps}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
);
const ClockIcon = () => (
  <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);

export const CashOutTracker: React.FC<CashOutTrackerProps> = ({
  txHash,
  usdtReceived,
  amountGSwapped,
  residualBalanceG = 0,
  residualBalanceUsdt = 0,
  bankName,
  accountNumber,
  accountHolderName,
  ngnPerUsdt = null,
  estimatedNaira: customEstimatedNaira,
  walletAddress,
  initialOrder = null,
  onSendDeposit,
  depositSent = false,
  initialStep,
  initialFailureState = null,
  delayedTimeoutMinutes = 15,
  onDone,
  onCancel,
  onOrderClosed,
  onSettled,
  language,
}) => {
  const {
    order: hookOrder,
    status: hookStatus,
    createOrder,
  } = useOffRamp();

  // Translations
  const t = language ? getTranslations(language) : undefined;

  // Internal state
  const [copied, setCopied] = useState(false);
  const [userSent, setUserSent] = useState(depositSent);
  const [sentAt, setSentAt] = useState<number | null>(depositSent ? Date.now() : null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(900); // 15 mins default
  const [activeFailure, setActiveFailure] = useState<'expired' | 'refunded' | 'delayed' | null>(
    initialFailureState
  );

  // Active order object (falls back to synthetic or initial order)
  const defaultOrderId = `ord-${txHash.slice(2, 10)}`;
  const [localOrder, setLocalOrder] = useState<OffRampOrder>(() => {
    if (initialOrder) {
      return {
        orderId: initialOrder.orderId ?? defaultOrderId,
        receiveAddress: initialOrder.receiveAddress ?? '',
        amountToSend: initialOrder.amountToSend ?? usdtReceived.toFixed(4),
        currency: initialOrder.currency ?? 'USDT',
        network: initialOrder.network ?? 'celo',
        memo: initialOrder.memo,
        amount: initialOrder.amount,
        rate: initialOrder.rate,
        expectedNaira: initialOrder.expectedNaira,
        senderFee: initialOrder.senderFee ?? '0.00',
        transactionFee: initialOrder.transactionFee ?? '0.00',
        validUntil:
          initialOrder.validUntil ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        status: (initialOrder.status as OffRampStatus) ?? 'initiated',
        paymentReference: initialOrder.paymentReference ?? `PAY-NGN-${txHash.slice(2, 8).toUpperCase()}`,
      };
    }
    return {
      orderId: defaultOrderId,
      receiveAddress: '',
      amountToSend: usdtReceived.toFixed(4),
      currency: 'USDT',
      network: 'celo',
      memo: undefined,
      amount: undefined,
      rate: undefined,
      expectedNaira: undefined,
      senderFee: '0.00',
      transactionFee: '0.00',
      validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: 'initiated',
      paymentReference: `PAY-NGN-${txHash.slice(2, 8).toUpperCase()}`,
    };
  });

  // Calculate Naira estimate from actual swap output — never a hardcoded rate.
  // usdtReceived is the real amount from the on-chain swap, so multiply directly
  // by the live NGN/USDT rate rather than re-deriving through getCashoutRate.
  const swapNairaEstimate: number | null = (() => {
    if (customEstimatedNaira && customEstimatedNaira > 0) return customEstimatedNaira;
    if (ngnPerUsdt && ngnPerUsdt > 0 && usdtReceived > 0) {
      return nairaFromUsdt(usdtReceived, ngnPerUsdt);
    }
    return null;
  })();

  // The order response is authoritative when available. amountToSend and fees
  // come from Paycrest; expected NGN is amount × rate from that response.
  const orderNairaEstimate: number | null = (() => {
    if (localOrder.expectedNaira !== undefined) {
      const value = Number(localOrder.expectedNaira);
      return Number.isFinite(value) ? value : null;
    }
    if (localOrder.amount && localOrder.rate) {
      const value = Number(localOrder.amount) * Number(localOrder.rate);
      return Number.isFinite(value) ? value : null;
    }
    return null;
  })();

  const nairaEstimate = orderNairaEstimate ?? swapNairaEstimate;

  // Auto-initiate Paycrest order creation on mount if not provided
  useEffect(() => {
    if (initialOrder) return;

    createOrder({
      amountUsdt: paycrestOrderAmount(usdtReceived),
      usdtReceived,
      swapTxHash: txHash,
      refundAddress: walletAddress,
      recipient: {
        institution: bankName,
        accountIdentifier: accountNumber,
        accountName: accountHolderName,
        memo: 'GoodCash payout',
      },
    }).catch(() => {
      // If backend worker is unreachable, keep localOrder fallback
    });
  }, [initialOrder, createOrder, usdtReceived, txHash, walletAddress, bankName, accountNumber, accountHolderName]);

  // After a reload we may only know the order id. Load the real payment details from the server
  // (never invent them), so the app can pay for the customer.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadTry, setLoadTry] = useState(0);
  useEffect(() => {
    const id = localOrder.orderId;
    if (localOrder.receiveAddress) return;
    // Give up waiting after a while, so nobody is left looking at a spinner
    const timer = setTimeout(() => setLoadFailed(true), 15000);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return () => clearTimeout(timer);
    }
    let alive = true;
    fetchOrderDetails(id)
      .then((d) => {
        if (!alive || !d.receiveAddress) return;
        setLoadFailed(false);
        setLocalOrder((prev) => ({
          ...prev,
          receiveAddress: d.receiveAddress ?? prev.receiveAddress,
          amountToSend: d.amountToSend ?? prev.amountToSend,
          validUntil: d.validUntil ?? prev.validUntil,
          status: (d.status as OffRampStatus) ?? prev.status,
        }));
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [localOrder.orderId, localOrder.receiveAddress, loadTry]);

  // Ask the server where this order is. This must not depend on the hook's own `order`: an order that arrives already
  // created (one tap, or after a reload) is never in the hook, and a check that needs it silently does nothing.
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const checkNow = React.useCallback(async () => {
    const id = localOrder.orderId;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return; // a made-up demo id is never asked about
    setRefreshing(true);
    try {
      const fresh = await fetchOrderStatus(id);
      setLocalOrder((prev) => ({
        ...prev,
        status: fresh.status,
        paymentReference: fresh.paymentReference ?? prev.paymentReference,
        receiveAddress: prev.receiveAddress || fresh.receiveAddress,
        amountToSend: prev.amountToSend || fresh.amountToSend,
        validUntil: prev.validUntil || fresh.validUntil,
      }));
      setCheckedAt(Date.now());
      setCheckFailed(false);
    } catch {
      setCheckFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [localOrder.orderId]);

  // Sync hookOrder updates
  useEffect(() => {
    if (hookOrder) {
      setLocalOrder(hookOrder);
    }
  }, [hookOrder]);

  // Sync failure state from hook status or props
  useEffect(() => {
    if (initialFailureState) {
      setActiveFailure(initialFailureState);
      return;
    }

    const currentStatus = hookOrder?.status ?? localOrder.status ?? hookStatus;
    if (currentStatus === 'expired') {
      setActiveFailure('expired');
    } else if (currentStatus === 'refunded' || currentStatus === 'refunding') {
      setActiveFailure('refunded');
    }
  }, [initialFailureState, hookOrder?.status, localOrder.status, hookStatus]);

  // If order status updates to deposited/pending, auto-set userSent and record sentAt
  useEffect(() => {
    const s = hookOrder?.status ?? localOrder.status;
    if (s === 'deposited' || s === 'pending' || s === 'fulfilling' || isPaidOutStatus(s)) {
      if (!userSent) setUserSent(true);
      if (!sentAt) setSentAt(Date.now());
    }
  }, [hookOrder?.status, localOrder.status, userSent, sentAt]);

  // How long the customer has been waiting, so a slow payout never feels like a frozen screen
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!sentAt) return;
    const iv = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, [sentAt]);
  const waitedMinutes = sentAt ? Math.floor((nowTick - sentAt) / 60_000) : null;

  // Check delayed payout timer if deposit initiated or user marked sent
  useEffect(() => {
    if (activeFailure || !sentAt) return;

    const interval = setInterval(() => {
      const elapsedMs = Date.now() - sentAt;
      const elapsedMinutes = elapsedMs / (1000 * 60);
      const isSettled = isPaidOutStatus(localOrder.status);

      if (!isSettled && elapsedMinutes >= delayedTimeoutMinutes) {
        setActiveFailure('delayed');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sentAt, activeFailure, delayedTimeoutMinutes, localOrder.status]);

  // Countdown timer for validUntil
  useEffect(() => {
    if (!localOrder.validUntil) return;
    const expiryTime = new Date(localOrder.validUntil).getTime();

    const updateTimer = () => {
      const remainingSecs = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
      setSecondsRemaining(remainingSecs);

      if (remainingSecs <= 0 && !userSent && !isPaidOutStatus(localOrder.status)) {
        setActiveFailure('expired');
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [localOrder.validUntil, userSent, localOrder.status]);

  // Poll status on load and on an interval regardless of tapping "I've sent it"
  useEffect(() => {
    if (isPaidOutStatus(localOrder.status) || localOrder.status === 'refunded' || localOrder.status === 'error' || activeFailure) return;

    // Check on load, then every few seconds until the order is finished
    void checkNow();
    const interval = setInterval(() => void checkNow(), 4000);
    return () => clearInterval(interval);
  }, [localOrder.status, activeFailure, checkNow]);

  // Format countdown string MM:SS
  const formatCountdown = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format validUntil target time
  const formatTargetTime = (isoString?: string) => {
    if (!isoString) return '15 minutes';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '15 minutes';
    }
  };

  // Tell the parent when the payout settles so History can show "Paid"
  const settledReported = useRef(false);
  useEffect(() => {
    if (isPaidOutStatus(localOrder.status) && !settledReported.current) {
      settledReported.current = true;
      onSettled?.({ orderId: localOrder.orderId, nairaAmount: nairaEstimate });
    }
  }, [localOrder.status, localOrder.orderId, nairaEstimate, onSettled]);

  // Determine current Step (1, 2, 3, or 4)
  // "Paying to your bank" is only true once a payment exists: our own confirmed transfer, or the
  // payout partner reporting that it has received one. Tapping "I've paid manually" proves nothing.
  const [paidByApp, setPaidByApp] = useState(depositSent);
  const paymentSeen =
    localOrder.status === 'deposited' ||
    localOrder.status === 'pending' ||
    localOrder.status === 'fulfilling' ||
    localOrder.status === 'settling';
  const paymentConfirmed = paidByApp || paymentSeen;
  const currentStep = (() => {
    if (initialStep !== undefined && initialStep > 2) return initialStep;
    if (isPaidOutStatus(localOrder.status)) return 4;
    if (paymentConfirmed) return 3;
    if (initialStep !== undefined) return initialStep;
    return 2; // Step 1 is completed instantly upon swap; default to Step 2 action
  })();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(localOrder.receiveAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const [supportOpen, setSupportOpen] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(() => {
    try {
      return localStorage.getItem('goodcash_support_email') ?? '';
    } catch {
      return '';
    }
  });
  const [notifyState, setNotifyState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  const handleNotify = async () => {
    const email = notifyEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setNotifyState('error');
      return;
    }
    setNotifyState('sending');
    try {
      const res = await fetch(`${ORDERS_API_BASE}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, email, ...(nairaEstimate ? { naira: `₦${Math.round(nairaEstimate).toLocaleString('en-US')}` } : {}) }),
      });
      if (!res.ok) throw new Error('notify failed');
      try {
        localStorage.setItem('goodcash_support_email', email);
      } catch {
        // optional convenience only
      }
      setNotifyState('done');
    } catch {
      setNotifyState('error');
    }
  };
  const addressReady =
    Boolean(localOrder.receiveAddress) &&
    localOrder.receiveAddress.toLowerCase() !== PLACEHOLDER_DEPOSIT_ADDRESS.toLowerCase();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [orderClosed, setOrderClosed] = useState(false);

  const handleSendNow = async () => {
    if (!onSendDeposit) return;
    setSending(true);
    setSendError(null);
    try {
      await onSendDeposit(localOrder.receiveAddress, localOrder.amountToSend, localOrder.orderId);
      setPaidByApp(true);
      handleUserSent();
    } catch (e) {
      const named = String((e as Error)?.name ?? '') + String((e as Error)?.message ?? '');
      if (/DepositPendingError/.test(named)) {
        // Sent, just not confirmed yet: move on and never invite a second payment
        setPaidByApp(true);
        handleUserSent();
        return;
      }
      if (/ORDER_EXPIRED/.test(named)) setOrderClosed(true);
      setSendError(friendlyPayError(e));
      if (!/ORDER_|user rejected|user denied|rejected the request/i.test(String((e as Error)?.message ?? ''))) {
        reportIssue('deposit_failed', e, { orderId, txHash });
      }
    } finally {
      setSending(false);
    }
  };

  const handleUserSent = () => {
    setUserSent(true);
    setSentAt(Date.now());
    void checkNow();
  };

  const emailPrompt = (
  <div className="gc-note" style={{ textAlign: 'left', marginBottom: 16 }}>
    {notifyState === 'done' ? (
      <><b>We'll email you</b> the moment your naira is sent. You can close the app.</>
    ) : (
      <>
        <b>Don't want to wait here?</b> We'll email you when your naira is sent.
        <div className="flex gap-2" style={{ marginTop: 8 }}>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            aria-label="Email me when it's sent"
            value={notifyEmail}
            onChange={(e) => { setNotifyEmail(e.target.value); if (notifyState === 'error') setNotifyState('idle'); }}
            placeholder="you@example.com"
                    className="min-w-0 flex-1 rounded-xl border-[2.5px] border-[#111] bg-white px-3 py-2 text-sm font-bold text-[#111] outline-none"
          />
          <button type="button" onClick={handleNotify} disabled={notifyState === 'sending'} className="gc-pill gc-pill--on gc-hit" style={{ flex: 'none' }}>
            {notifyState === 'sending' ? 'Saving…' : 'Email me'}
          </button>
        </div>
        {notifyState === 'error' && (
                  <div role="alert" style={{ color: '#b00020', marginTop: 6 }}>Please enter a valid email address and try again.</div>
        )}
      </>
    )}
  </div>
  );

  const explorerUrl = `https://celo.blockscout.com/tx/${txHash}`;
  const orderId = localOrder.orderId;
  const bankReference = localOrder.paymentReference || `PAY-NGN-${txHash.slice(2, 8).toUpperCase()}`;

  const stepState = (n: 1 | 2 | 3 | 4): 'done' | 'current' | 'wait' => {
    if (n === 1) return 'done';
    if (n === 4) return currentStep === 4 ? 'done' : 'wait';
    return currentStep > n ? 'done' : currentStep === n ? 'current' : 'wait';
  };
  const timeline: { n: 1 | 2 | 3 | 4; label: string }[] = [
    { n: 1, label: '1 G$ converted' },
    { n: 2, label: '2 Confirm payment' },
    { n: 3, label: '3 Paying to your bank' },
    { n: 4, label: '4 Done' },
  ];
  const stateText = { done: 'Done', current: 'In progress', wait: 'Waiting' } as const;
  const failureCard = 'gc-card';
  const failureBtns = 'gc-btn gc-hit';
  const failureBtnsAlt = 'gc-btn gc-btn--white gc-hit';

  return (
    <div className="gc-tracker flex flex-col gap-3 w-full max-w-xl mx-auto animate-fade-in" aria-live="polite">
      {/* Headline */}
      <div>
        <div className="gc-title gc-title--status">{currentStep === 4 ? 'All done' : 'On its way'}</div>
        <p className="gc-sm" style={{ margin: '2px 0 0', color: '#222' }}>
          We’ll update this page as each step finishes.
        </p>
      </div>

      {/* Amount */}
      {currentStep !== 4 && (
      <div className="gc-card gc-card--mint">
        <div className="gc-lab">You get about</div>
        <div className="gc-big">
          ≈ ₦{nairaEstimate !== null ? nairaEstimate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </div>
        <div className="gc-sm">
          {orderNairaEstimate !== null ? 'Set by your payout order' : 'Final amount is set when the payout completes'}
        </div>
      </div>
      )}

      {/* Timeline */}
      <div className="gc-card">
        {timeline.map((step, idx) => {
          const st = stepState(step.n);
          const last = idx === timeline.length - 1;
          const nextDone = !last && stepState(timeline[idx + 1].n) !== 'wait';
          return (
            <div className="gc-tl" key={step.n}>
              <div className="gc-tl__col">
                <i className={`gc-dot ${st === 'done' ? 'gc-dot--done' : st === 'current' ? 'gc-dot--current' : ''}`} />
                {!last && <i className={`gc-ln ${nextDone ? '' : 'gc-ln--wait'}`} />}
              </div>
              <div className="gc-tl__step">
                <b>{step.label}</b>
                <p style={last ? { margin: 0 } : undefined}>{stateText[st]}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* FAILURE STATES */}
      {activeFailure === 'expired' && (
        <div className={failureCard} style={{ background: '#ffd23f' }}>
          <div className="gc-lab" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><WarnIcon /> payment window expired</div>
          <p className="gc-sm" style={{ margin: '6px 0' }}>
            The payment window closed before the payment arrived. Nothing was taken. Please do not send anything to the old address.
          </p>
          {/^[0-9a-f-]{36}$/i.test(orderId) && <div className="gc-note" style={{ marginBottom: 10 }}>Order ID: <b>{orderId}</b></div>}
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setSupportOpen(true)} className={failureBtns}>Contact support</button>
            <button type="button" onClick={onDone} className={failureBtnsAlt}>Back to Dashboard</button>
          </div>
        </div>
      )}

      {activeFailure === 'refunded' && (
        <div className={failureCard} style={{ background: '#ff9b9b' }}>
          <div className="gc-lab" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UndoIcon /> order refunded</div>
          <p className="gc-sm" style={{ margin: '6px 0' }}>
            This order was refunded to your Celo wallet. Any deposited funds have been returned.
          </p>
          {/^[0-9a-f-]{36}$/i.test(orderId) && <div className="gc-note" style={{ marginBottom: 10 }}>Order ID: <b>{orderId}</b></div>}
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setSupportOpen(true)} className={failureBtns}>Contact support</button>
            <button type="button" onClick={onDone} className={failureBtnsAlt}>Back to Dashboard</button>
          </div>
        </div>
      )}

      {activeFailure === 'delayed' && (
        <div className={failureCard} style={{ background: '#ffd23f' }}>
          <div className="gc-lab" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ClockIcon /> Payment sent but naira not received after {delayedTimeoutMinutes} minutes</div>
          <p className="gc-sm" style={{ margin: '6px 0' }}>
            Your payment is safe and was received. The bank payout is taking longer than usual. It normally takes a few minutes, but it can take up to about 20 minutes. If it is still not there soon, tap Contact support and we will look into it straight away.
          </p>
          {/^[0-9a-f-]{36}$/i.test(orderId) && <div className="gc-note" style={{ marginBottom: 10 }}>Order ID: <b>{orderId}</b></div>}
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setSupportOpen(true)} className={failureBtns}>Contact support</button>
            <button type="button" onClick={() => void checkNow()} disabled={refreshing} className={failureBtnsAlt}>{refreshing ? 'Checking…' : 'Check again'}</button>
          </div>
        </div>
      )}

      {/* STEP CONTENT */}
      {!activeFailure && currentStep === 1 && (
        <div className="gc-card gc-card--mint" style={{ textAlign: 'center' }}>
          <div className="gc-big" style={{ fontSize: 20 }}>
            ✓ Converted {amountGSwapped.toLocaleString()} G$ to dollars
          </div>
          <div className="gc-sm">Preparing off-ramp transfer...</div>
        </div>
      )}

      {!activeFailure && currentStep === 2 && (
        <>
          {userSent && !paymentConfirmed && (
            <div className="gc-note" role="status" style={{ background: '#ffd23f' }}>
              <b>Checking for your payment…</b> If you already sent it, you don't need to do anything. It can take a minute or two to show up here.
            </div>
          )}
          {onSendDeposit && (
            <div className="gc-card gc-card--mint">
              <div className="gc-lab">One last step</div>
              <p className="gc-sm" style={{ margin: '6px 0 0' }}>
                Confirm the payment in your wallet and your naira is on its way to your bank.
              </p>
            </div>
          )}
          {onSendDeposit && (
            <>
              <button type="button" onClick={handleSendNow} disabled={sending || !addressReady} className={`gc-btn gc-hit ${sending || !addressReady ? 'gc-btn--dis' : ''}`}>
                {sending ? 'Confirm in your wallet…' : addressReady ? 'Pay now' : 'Getting your payment ready…'}
              </button>
              {sending && !hasInjectedWallet() && getWalletLink() && (
                <button type="button" className="gc-btn gc-btn--white gc-hit" onClick={openWalletApp}>
                  Open {getWalletLink()?.name} to confirm
                </button>
              )}
              {sendError && (
                <div className="gc-note" role="alert" style={{ background: '#ff9b9b', overflowWrap: 'anywhere' }}>{sendError}</div>
              )}
              {orderClosed && onOrderClosed && (
                <button type="button" onClick={onOrderClosed} className="gc-btn gc-btn--white gc-hit">Start a fresh payout</button>
              )}
            </>
          )}
          {addressReady ? (
          <details open={!onSendDeposit} className="gc-fold" style={onSendDeposit ? { marginTop: 4, paddingTop: 10, borderTop: '2px dashed #9b86d6' } : undefined}>
            <summary className="gc-sm gc-hit" style={{ display: onSendDeposit ? 'block' : 'none', cursor: 'pointer', textDecoration: 'underline', textAlign: 'center', padding: '4px 0' }}>
              Having trouble? Pay manually instead
            </summary>
          <div className="gc-card">
            <div className="gc-row" style={{ marginBottom: 8 }}>
              <div className="gc-lab">Deposit Instructions</div>
              <span className="gc-pill gc-pill--yellow">Expires in {formatCountdown(secondsRemaining)}</span>
            </div>
            <p className="gc-sm" style={{ margin: '0 0 10px' }}>
              Send exactly <b>{localOrder.amountToSend} USDT</b> to this address before{' '}
              <b>{formatTargetTime(localOrder.validUntil)}</b>:
            </p>

            <div className="gc-cost" style={{ marginBottom: 10 }}>
              <div className="gc-row">
                <span>Amount to send</span>
                <span><b>{localOrder.amountToSend} USDT</b></span>
              </div>
              <div className="gc-row"><span>Network</span><span>Celo Network</span></div>
              <div className="gc-row"><span>Sender fee</span><span>{localOrder.senderFee} USDT</span></div>
              <div className="gc-row"><span>Transaction fee</span><span>{localOrder.transactionFee} USDT</span></div>
              <div className="gc-row">
                <span>Expected naira</span>
                <span>
                  {orderNairaEstimate !== null
                    ? `₦${orderNairaEstimate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : '—'}
                </span>
              </div>
            </div>

            <div className="gc-note" style={{ marginBottom: 10 }}>
              <div className="gc-lab" style={{ marginBottom: 4 }}>Deposit address</div>
              <div className="gc-row" style={{ alignItems: 'flex-start' }}>
                <span className="font-mono break-all select-all" style={{ fontSize: 12 }}>{localOrder.receiveAddress}</span>
                <button type="button" onClick={handleCopy} className="gc-pill gc-pill--white shrink-0">
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {localOrder.memo && (
              <div className="gc-note" style={{ marginBottom: 10 }}>
                <div className="gc-lab" style={{ marginBottom: 4 }}>Deposit Memo / Reference</div>
                <span className="font-mono" style={{ fontSize: 12 }}>{localOrder.memo}</span>
              </div>
            )}

            <div className="gc-note" style={{ background: '#ffd23f' }}>
              <b>Warning:</b> A smaller amount is refunded. Please send the exact amount specified.
            </div>
          </div>

            {onSendDeposit && (
              <button type="button" onClick={handleUserSent} className="gc-btn gc-btn--white gc-hit" style={{ marginTop: 10 }}>
                I've paid manually →
              </button>
            )}
          </details>
          ) : (
            (loadFailed || !onSendDeposit) && (
              loadFailed ? (
                <div className="gc-note" role="alert" style={{ background: '#ff9b9b' }}>
                  <b>We couldn't load your payment.</b> Nothing was sent. Check your connection and try again.
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="gc-pill gc-pill--white gc-hit" onClick={() => { setLoadFailed(false); setLoadTry((n) => n + 1); }}>Try again</button>
                    {onOrderClosed && (
                      <button type="button" className="gc-pill gc-pill--white gc-hit" onClick={onOrderClosed}>Start fresh</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="gc-note" role="status">
                  <b>Getting your payment ready…</b> This only takes a moment.
                </div>
              )
            )
          )}
          {!onSendDeposit && addressReady && (
            <button type="button" onClick={handleUserSent} className="gc-btn gc-hit">
              I've sent it →
            </button>
          )}
        </>
      )}

      {!activeFailure && currentStep === 3 && (
        <div className="gc-card" style={{ textAlign: 'center' }}>
          <div className="w-10 h-10 rounded-full border-4 border-[#7b39fc] border-t-transparent animate-spin mx-auto mb-3" />
          <h3 className="gc-big" style={{ fontSize: 22 }}>Paying to your bank</h3>
          <p className="gc-sm" style={{ margin: '6px 0 4px' }}>{payoutStageText(localOrder.status)}</p>
          <p className="gc-sm" style={{ margin: '0 0 10px', opacity: 0.85 }}>
            Usually a few minutes. Sometimes up to 20.
            {waitedMinutes !== null && waitedMinutes >= 1 ? ` Waiting ${waitedMinutes} min so far.` : ''}
          </p>
          {emailPrompt}
          <div className="gc-cost" style={{ textAlign: 'left', marginBottom: 12 }}>
            <div className="gc-row"><span>Destination Bank:</span><span>{bankName}</span></div>
            <div className="gc-row"><span>Account Number:</span><span className="font-mono">{accountNumber}</span></div>
            <div className="gc-row"><span>Beneficiary:</span><span>{accountHolderName}</span></div>
          </div>
          <div className="gc-sm" style={{ textAlign: 'center', margin: '0 0 8px', opacity: 0.8 }}>This page updates by itself. You only need to refresh if it seems stuck.</div>
          <button type="button" onClick={() => void checkNow()} disabled={refreshing} className="gc-btn gc-btn--white gc-hit" style={{ gap: 8 }}>
            <RefreshIcon /> {refreshing ? 'Checking…' : 'Refresh status'}
          </button>
          {checkFailed ? (
            <div className="gc-sm" role="status" style={{ textAlign: 'center', marginTop: 8, color: '#b00020' }}>We couldn't check just now. Please try again in a moment.</div>
          ) : checkedAt ? (
            <div className="gc-sm" role="status" style={{ textAlign: 'center', marginTop: 8, opacity: 0.8 }}>Checked just now. Still waiting for your bank.</div>
          ) : null}
        </div>
      )}

      {!activeFailure && currentStep === 4 && (
        <>
          <div className="gc-hero" style={{ height: 120, margin: 0, borderRadius: 18, border: '2.5px solid #111' }}>
            <div className="absolute left-1/2 top-0 w-[138px] -translate-x-1/2">
              <i className="gc-c1" style={{ width: 44, height: 44, left: 38, top: 24 }} />
              <i className="gc-c1" style={{ width: 30, height: 30, left: 98, top: 62 }} />
              <i className="gc-c1" style={{ width: 22, height: 22, left: 4, top: 66 }} />
            </div>
          </div>
          <div className="gc-card" style={{ textAlign: 'center', marginTop: -6 }}>
            <div className="gc-ok">✓</div>
            <div className="gc-big gc-big--success">{t?.nairaDelivered || 'Naira Delivered!'}</div>
            <div className="gc-sm">{t?.paidToYourBank || 'paid to your bank'}</div>
          </div>
          <div className="gc-card gc-cost">
            <div className="gc-row">
              <span>Bank Reference:</span>
              <span className="font-mono">{bankReference || 'PAY-NGN-' + txHash.slice(2, 8).toUpperCase()}</span>
            </div>
            <div className="gc-row"><span>Transaction receipt</span>
              <a href={explorerUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>View on Explorer ↗</a>
            </div>
          </div>
          <button type="button" onClick={onDone} className="gc-btn gc-hit">
            {t?.doneButton || 'Done'}
          </button>
        </>
      )}

      {/* DETAILS CARD */}
      <div className="gc-card gc-cost">
        <div className="gc-lab" style={{ marginBottom: 2 }}>Details</div>
        <div className="gc-row">
          <span>Transaction:</span>
          <span className="font-mono truncate" style={{ maxWidth: 200, fontSize: 12 }}>{txHash}</span>
        </div>
        <div className="gc-row">
          <span>Explorer Link:</span>
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
            View on Celo Explorer ↗
          </a>
        </div>
        {/^[0-9a-f-]{36}$/i.test(orderId) && (
          <div className="gc-row">
            <span>Order ID:</span>
            <span className="font-mono select-all" style={{ fontSize: 12 }}>{orderId}</span>
          </div>
        )}
      </div>

      {supportOpen && (
        <SupportModal
          onClose={() => setSupportOpen(false)}
          defaultTopic={activeFailure === 'delayed' ? 'not_arrived' : 'payment_failed'}
          context={{
            orderId,
            txHash,
            wallet: walletAddress && !/^0x0{40}$/.test(walletAddress) ? walletAddress : undefined,
            status: activeFailure ?? localOrder.status,
            amountG: amountGSwapped ? amountGSwapped.toLocaleString() : undefined,
            naira: nairaEstimate !== null ? `₦${Math.round(nairaEstimate).toLocaleString()}` : undefined,
          }}
        />
      )}

      {onCancel && currentStep < 3 && (
        <button onClick={onCancel} className="gc-btn gc-btn--white gc-hit">
          Cancel and start new cash out
        </button>
      )}
    </div>
  );
};

