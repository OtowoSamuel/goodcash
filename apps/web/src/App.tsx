import { gToWei, nairaFromUsdt } from './lib/units';
import { Modal } from './components/Modal';
import { getWalletLink, openWalletApp } from './lib/walletLink';
import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { SafetyBanner } from './components/SafetyBanner';
import { ReadinessCard } from './components/ReadinessCard';
const AddGsModal = React.lazy(() => import('./components/AddGsModal'));
/** Naira -> G$ is parked (it needs the customer's BVN/NIN). Only builds that set VITE_ADDG_ENABLED=true show it. */
const ADDG_ENABLED = import.meta.env.VITE_ADDG_ENABLED === 'true';
import { CashOutCard } from './components/CashOutCard';
import { MobileCashOut } from './components/MobileCashOut';
import { MobileReviewView } from './components/MobileReviewView';
import { MobileProcessingView } from './components/MobileProcessingView';
import { MobileSuccessView } from './components/MobileSuccessView';
import { MobileHistoryView } from './components/MobileHistoryView';
import { MobileBottomNav } from './components/MobileBottomNav';
import { ConfirmModal } from './components/ConfirmModal';
import { CashOutTracker } from './components/CashOutTracker';
import { HistoryCard, getHistoryNaira, type SwapHistoryItem } from './components/HistoryCard';
import type { BankDetailsState } from './lib/useBankDetails';
import type { Language } from './lib/i18n';
import { getTranslations } from './lib/i18n';
import { fetchPaycrestRate, MIN_NET_USDT_REQUIRED, ORDERS_API_BASE, getMinimumCashOutG, formatNaira } from './lib/rate';
import { BLOCKSCOUT_URL } from './components/SafetyBanner';
import { getNetQuote, type QuoteResult } from './lib/quote';
import { LIVE_QUOTES, getLiveNetQuote } from './lib/liveQuote';
import { decodeCashOutEvent, emitAnalyticsEvent } from './lib/analytics';
import { detectMiniPay } from './lib/mobile';
import { MiniPayNotice } from './components/MiniPayNotice';
import { executeRouterSwap, IS_DEMO_MODE, fetchGBalance, friendlySwapError, friendlyConnectError, disconnectInjectedWallet, hasInjectedWallet, fetchSwapForRecovery, sendUsdtDeposit, DepositPendingError, SwapPendingError, fetchUsdtBalance, subscribeWalletEvents, ONE_TAP_ENABLED, computeOneTapMinOut, executeOneTapCashOut, isOneTapRouterPaused, chooseCashOutFlow, getNetworkFeeInfo, celoText, type NetworkFeeInfo } from './lib/router';
import { createPaycrestOrder, createOneTapOrder, linkOneTapSwap, fetchOrderDetails, fetchOrderStatus, fetchUnfinishedSwaps, fetchWalletHistory, paycrestOrderAmount, type OffRampOrder, type OneTapOrder } from './lib/useOffRamp';
import { mergeServerHistory, isHiddenSwap } from './lib/historySync';
import { MAGIC_ENABLED, finishMagicLogin, restoreMagic, disconnectMagic, type MagicLoginResult } from './lib/magicWallet';
import { PendingPayoutCard } from './components/PendingPayoutCard';
import { reportIssue } from './lib/diag';

export const PENDING_PAYOUT_KEY = 'goodcash_pending_payout';

export interface PendingPayoutRecord {
  txHash: string;
  usdtReceived: number;
  amountG?: number;
}

function readPendingPayout(): PendingPayoutRecord | null {
  if (typeof localStorage === 'undefined') return null;
  const saved = localStorage.getItem(PENDING_PAYOUT_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as Partial<PendingPayoutRecord>;
    if (typeof parsed?.txHash === 'string' && typeof parsed?.usdtReceived === 'number') {
      return {
        txHash: parsed.txHash,
        usdtReceived: parsed.usdtReceived,
        ...(typeof parsed.amountG === 'number' ? { amountG: parsed.amountG } : {}),
      };
    }
  } catch {
    // Ignore malformed records.
  }
  return null;
}

function savePendingPayout(record: PendingPayoutRecord): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PENDING_PAYOUT_KEY, JSON.stringify(record));
}

const DISMISSED_KEY = 'goodcash_dismissed_swaps';

function readDismissedSwaps(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function dismissSwap(txHash: string): void {
  try {
    const set = readDismissedSwaps();
    set.add(txHash.toLowerCase());
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set].slice(-50)));
  } catch {
    // optional convenience only
  }
}

function clearPendingPayout(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(PENDING_PAYOUT_KEY);
}

const INITIAL_HISTORY: SwapHistoryItem[] = [
  {
    id: 'tx-mainnet-test',
    txHash: '0x1f73b2d4af5cd391f0eb1d319f262a1cad73a47ade16f03612eea89948b5e705',
    timestamp: Date.now() - 3600000,
    amountInG: 1000,
    amountOutUsdt: 0.114107,
    route: 'GoodDollar Reserve → Uniswap V3 (fee 100)',
    steps: {
      swapped: 'completed',
      sentToPartner: 'unknown',
      paidInNaira: 'unknown',
    },
  },
];

export interface AppProps {
  isDemoMode?: boolean;
  walletAddress?: string | null;
}

export function App({
  isDemoMode = IS_DEMO_MODE,
  walletAddress: initialWalletAddress = !import.meta.env.PROD ? '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF' : null,
}: AppProps = {}) {
  const [currentTab, setCurrentTab] = useState<'home' | 'cashout' | 'history' | 'offramp'>('home');
  const [language] = useState<Language>('en');
  const [miniPayBlocked, setMiniPayBlocked] = useState<boolean>(() => detectMiniPay());
  const [walletAddress, setWalletAddress] = useState<string | null>(initialWalletAddress);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [pendingSwapResult, setPendingSwapResult] = useState<{
    txHash: string;
    usdtReceived: number;
    amountG?: number;
  } | null>(() => readPendingPayout());

  const [balanceG, setBalanceG] = useState<number>(() => {
    if (import.meta.env.PROD) return 0;
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('goodcash_balance_g') : null;
    const parsed = cached !== null ? parseFloat(cached) : NaN;
    if (Number.isFinite(parsed) && (parsed > 0 || !isDemoMode)) return parsed;
    return isDemoMode ? 50000 : 0;
  });
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<number>(() => {
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('goodcash_balance_updated_at') : null;
    return cached ? Number(cached) : Date.now();
  });
  const [activeCashOutAmount, setActiveCashOutAmount] = useState<string>('');
  const [savedBankDetails, setSavedBankDetails] = useState<BankDetailsState | null>(null);

  const [history, setHistory] = useState<SwapHistoryItem[]>(() => {
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('goodcash_history') : null;
    if (!cached) return import.meta.env.PROD ? [] : INITIAL_HISTORY;
    const parsed: SwapHistoryItem[] = JSON.parse(cached);
    // The sample row was a developer test swap; real users must never see it
    const visible = import.meta.env.PROD ? parsed.filter((h) => h.id !== 'tx-mainnet-test') : parsed;
    // Older versions saved a row for every payout order; keep one row per swap (the paid one if any)
    const bySwap = new Map<string, SwapHistoryItem>();
    for (const h of visible) {
      const key = (h.txHash || h.id).toLowerCase();
      const existing = bySwap.get(key);
      if (!existing) {
        bySwap.set(key, h);
        continue;
      }
      const keepNew = h.steps?.paidInNaira === 'completed' && existing.steps?.paidInNaira !== 'completed';
      const base = keepNew ? h : existing;
      bySwap.set(key, { ...base, amountInG: base.amountInG || existing.amountInG || h.amountInG, nairaAmount: base.nairaAmount ?? existing.nairaAmount ?? h.nairaAmount });
    }
    return [...bySwap.values()];
  });

  // A swap is one cash out, however many times its payout order is retried
  const upsertHistory = (item: SwapHistoryItem) => {
    setHistory((prev) => {
      const i = prev.findIndex((h) => h.txHash.toLowerCase() === item.txHash.toLowerCase());
      if (i === -1) return [item, ...prev];
      const old = prev[i];
      const merged: SwapHistoryItem = {
        ...old,
        ...item,
        id: old.id,
        timestamp: old.timestamp,
        amountInG: item.amountInG || old.amountInG,
        steps: old.steps?.paidInNaira === 'completed' ? old.steps : item.steps,
      };
      return prev.map((h, idx) => (idx === i ? merged : h));
    });
  };

  const [pendingQuote, setPendingQuote] = useState<{
    quote: QuoteResult;
    amountG: number;
    slippageBps: number;
    bankName?: string;
    accountNumber?: string;
    accountHolderName?: string;
    ngnPerUsdt?: number | null;
    bankCode?: string;
  } | null>(null);

  const [trackerData, setTrackerData] = useState<{
    txHash: string;
    usdtReceived: number;
    amountGSwapped: number;
    bankName?: string;
    accountNumber?: string;
    accountHolderName?: string;
    ngnPerUsdt?: number | null;
    orderId?: string;
    initialOrder?: OffRampOrder;
    depositSent?: boolean;
  } | null>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('goodcash_active_tracker');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // An unpaid order's payment window is short. Drop a stale one so the swap is offered again fresh.
          if (parsed && typeof parsed === 'object' && !parsed.depositSent && parsed.savedAt && Date.now() - parsed.savedAt > 25 * 60 * 1000) {
            return null;
          }
          if (parsed && typeof parsed === 'object') {
            return {
              txHash: parsed.txHash || '',
              orderId: parsed.orderId,
              usdtReceived: parsed.usdtReceived || 0,
              amountGSwapped: parsed.amountGSwapped || 0,
              ngnPerUsdt: parsed.ngnPerUsdt || null,
              depositSent: Boolean(parsed.depositSent),
            };
          }
        } catch {}
      }
    }
    return null;
  });

  const [showPrivacy, setShowPrivacy] = useState(false);

  // Live NGN rate for Home / History so naira figures are not blank
  const [confirmStage, setConfirmStage] = useState<'swap' | 'order' | 'pay' | null>(null);
  // Which wallet confirmation is the customer being asked for right now (shown as plain words)
  const [walletStep, setWalletStep] = useState<{ kind: 'approve' | 'swap' | 'order' | 'pay'; n: number; total: number } | null>(null);
  const stepTotalRef = useRef(3);
  useEffect(() => {
    if (!confirmStage) setWalletStep(null);
  }, [confirmStage]);
  const phoneWallet = !hasInjectedWallet() ? getWalletLink() : null;
  const walletName = phoneWallet?.name ?? 'your wallet';
  const walletStepTitle = walletStep
    ? walletStep.kind === 'order'
      ? 'Setting up your payout'
      : walletStep.total === 1
      ? 'Confirm in your wallet'
      : `Step ${walletStep.n} of ${walletStep.total}`
    : null;
  const walletStepBody = walletStep
    ? walletStep.kind === 'approve'
      ? 'Allow GoodCash to use your G$ for this cash out.'
      : walletStep.kind === 'swap' && walletStep.total === 1
      ? 'One confirmation does it all. Your naira is then on its way to your bank.'
      : walletStep.kind === 'swap'
      ? 'Confirm the cash out. Your G$ is converted to dollars in your wallet.'
      : walletStep.kind === 'order'
      ? 'Nothing to confirm yet. This only takes a moment.'
      : 'Send the payment. After this, your naira is on its way to your bank.'
    : null;
  const [confirmResult, setConfirmResult] = useState<{ settled: boolean; paid?: boolean; nairaText: string; reference: string | null } | null>(null);
  const [walletMessage, setWalletMessage] = useState<string | null>(null);
  const [okNotice, setOkNotice] = useState<string | null>(null);
  const [previewUsdt, setPreviewUsdt] = useState<number | null>(null);
  const [liveNgnRate, setLiveNgnRate] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetchPaycrestRate()
      .then((r) => { if (alive) setLiveNgnRate(r); })
      .catch(() => { if (alive && IS_DEMO_MODE) setLiveNgnRate(1452.6); });
    return () => { alive = false; };
  }, []);

  // Debug view toggle for mobile testing
  const [mobileView, setMobileView] = useState<
    'home' | 'cashout' | 'history' | 'offramp' | 'review' | 'processing' | 'success' | 'finish'
  >('home');

  const t = getTranslations(language);

  // Mobile has no tracker screen: watch the order and move to Success when it settles
  useEffect(() => {
    const orderId = trackerData?.orderId;
    if (mobileView !== 'processing' || !orderId) return;
    let alive = true;
    const finish = () => {
      if (!alive) return;
      const naira = trackerData?.ngnPerUsdt ? nairaFromUsdt(trackerData.usdtReceived, trackerData.ngnPerUsdt) : null;
      setHistory((prev) =>
        prev.map((h) =>
          h.orderId === orderId
            ? {
                ...h,
                ...(naira !== null ? { nairaAmount: naira } : {}),
                steps: { swapped: 'completed', sentToPartner: 'completed', paidInNaira: 'completed' },
              }
            : h
        )
      );
      setMobileView('success');
    };
    const check = async () => {
      if (trackerData?.initialOrder?.status === 'settled' || trackerData?.initialOrder?.status === 'validated') return finish();
      try {
        const order = await fetchOrderStatus(orderId);
        if (order.status === 'settled' || order.status === 'validated') finish();
      } catch {
        // Demo mode has no payout API: treat the mock order as settled after a short wait
        if (isDemoMode) finish();
      }
    };
    const first = setTimeout(check, 2500);
    const iv = setInterval(check, 6000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileView, trackerData?.orderId]);

  // Auto-navigate to cashout tab if there's a pending payout on mount
  // Only on first load: jump straight to the unfinished payout. Never again after that,
  // or the Home tab would bounce the user back to Cash out and trap them there.
  useEffect(() => {
    if (pendingSwapResult) setCurrentTab('cashout');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      if (trackerData && (trackerData.orderId || trackerData.txHash)) {
        localStorage.setItem(
          'goodcash_active_tracker',
          JSON.stringify({
            orderId: trackerData.orderId,
            txHash: trackerData.txHash,
            usdtReceived: trackerData.usdtReceived,
            amountGSwapped: trackerData.amountGSwapped,
            ngnPerUsdt: trackerData.ngnPerUsdt ?? null,
            depositSent: trackerData.depositSent ?? false,
            savedAt: (() => {
              try {
                const prev = JSON.parse(localStorage.getItem('goodcash_active_tracker') ?? '{}') as { orderId?: string; savedAt?: number };
                return prev.orderId === trackerData.orderId && prev.savedAt ? prev.savedAt : Date.now();
              } catch {
                return Date.now();
              }
            })(),
          })
        );
      } else {
        localStorage.removeItem('goodcash_active_tracker');
      }
    }
  }, [trackerData]);

  useEffect(() => {
    setMiniPayBlocked(detectMiniPay());
  }, []);

  useEffect(() => {
    if (miniPayBlocked && walletAddress) {
      setWalletAddress(null);
    }
  }, [miniPayBlocked, walletAddress]);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('goodcash_balance_g', balanceG.toString());
      localStorage.setItem('goodcash_balance_updated_at', String(Date.now()));
      setBalanceUpdatedAt(Date.now());
    }
  }, [balanceG]);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('goodcash_history', JSON.stringify(history));
    }
  }, [history]);

  // Pick up where the customer left off after a reload (a wallet they connected, or their Magic email wallet)
  useEffect(() => {
    if (isDemoMode || initialWalletAddress) return;
    let alive = true;
    restoreMagic().then((acct) => {
      if (alive && acct) setWalletAddress(acct);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wallet connection is Magic's Wallet Kit panel (loaded on demand). It reports back through onMagicConnected.
  // Whether the one-tap router is paused right now (decides what the review screen promises)
  const [oneTapPaused, setOneTapPaused] = useState(false);
  useEffect(() => {
    if (!ONE_TAP_ENABLED || isDemoMode || !pendingQuote) return;
    let alive = true;
    isOneTapRouterPaused().then((p) => alive && setOneTapPaused(p)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pendingQuote, isDemoMode]);

  const [magicOpen, setMagicOpen] = useState(false);
  const MagicConnect = React.useMemo(() => React.lazy(() => import('./components/MagicConnect')), []);

  const handleConnectWallet = async () => {
    if (miniPayBlocked || detectMiniPay()) return;
    if (isDemoMode) {
      setWalletAddress('0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF');
      setWalletMessage(null);
      return;
    }
    if (!MAGIC_ENABLED) {
      setWalletMessage('Wallet connection is not set up in this build yet.');
      return;
    }
    setWalletMessage(null);
    setMagicOpen(true);
  };

  const onMagicConnected = async (result: MagicLoginResult) => {
    setMagicOpen(false);
    try {
      reportIssue('magic_login_ok', new Error(`method=${result.method}`));
      const address = await finishMagicLogin(result);
      setWalletAddress(address);
      setWalletMessage(null);
      emitAnalyticsEvent('wallet_connected', {
        wallet: address,
        wallet_type: result.method === 'wallet' ? 'other' : 'other',
        referral_tag: 'direct',
      });
    } catch (err) {
      onMagicError(err, 'after-login');
    }
  };

  const onMagicError = (err: unknown, stage: 'panel' | 'after-login' = 'panel') => {
    setMagicOpen(false);
    setWalletMessage(friendlyConnectError(err));
    const code = (err as { code?: unknown } | null)?.code;
    // The customer simply closing or cancelling is not worth a report
    if (code !== 4001) {
      const e = err as { name?: string; message?: string; rawMessage?: string; data?: unknown; stack?: string } | null;
      const where = String(e?.stack ?? '').split('\n').slice(1, 3).map((l) => l.trim().replace(/https?:\/\/[^/]+/, '')).join(' < ');
      reportIssue(
        'wallet_connect_failed',
        new Error(`kind=magic stage=${stage} code=${String(code ?? '-')} name=${e?.name ?? '-'} ${e?.message ?? ''} raw=${e?.rawMessage ?? '-'} data=${JSON.stringify(e?.data ?? null)?.slice(0, 80)} at=${where}`)
      );
    }
  };

  useEffect(() => {
    if (!okNotice) return;
    const t = setTimeout(() => setOkNotice(null), 12000);
    return () => clearTimeout(t);
  }, [okNotice]);

  useEffect(() => {
    if (!walletMessage) return;
    const t = setTimeout(() => setWalletMessage(null), 8000);
    return () => clearTimeout(t);
  }, [walletMessage]);

  // No wallet, no balance (production)
  useEffect(() => {
    if (!isDemoMode && !walletAddress) setBalanceG(0);
  }, [isDemoMode, walletAddress]);

  // Real G$ balance from Celo (production only; demo keeps its mock balance)
  useEffect(() => {
    if (isDemoMode || !walletAddress) return;
    let alive = true;
    const load = () =>
      fetchGBalance(walletAddress)
        .then((b) => { if (alive) setBalanceG(Math.floor(b * 100) / 100); })
        .catch(() => {});
    load();
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [isDemoMode, walletAddress]);

  // The network fee is paid in CELO. Check it while a cash out is being reviewed, so the customer is told
  // before they press Confirm, not by a failed swap.
  const [networkFee, setNetworkFee] = useState<NetworkFeeInfo | null>(null);
  const reviewing = !!pendingQuote || mobileView === 'review';
  useEffect(() => {
    if (isDemoMode || !walletAddress) {
      setNetworkFee(null);
      return;
    }
    let alive = true;
    const flow = chooseCashOutFlow(ONE_TAP_ENABLED, oneTapPaused);
    const load = () => void getNetworkFeeInfo(walletAddress, flow).then((info) => alive && setNetworkFee(info));
    load();
    const iv = reviewing ? setInterval(load, 20000) : undefined;
    return () => {
      alive = false;
      if (iv) clearInterval(iv);
    };
  }, [isDemoMode, walletAddress, oneTapPaused, reviewing]);
  const [addOpen, setAddOpen] = useState(false);
  const handleAddClick = () => {
    if (isDemoMode) {
      setWalletMessage('Adding G$ works with a real wallet. Connect your wallet to try it.');
      return;
    }
    if (!walletAddress) {
      handleConnectWallet();
      return;
    }
    setAddOpen(true);
  };
  const [walletSheetOpen, setWalletSheetOpen] = useState(false);
  const handleDisconnectWallet = () => {
    // Sign out of Magic (closes a Magic email wallet or a connected wallet); a browser wallet is also asked to forget this site
    void disconnectMagic();
    if (hasInjectedWallet()) void disconnectInjectedWallet();
    setWalletAddress(null);
    setWalletMessage(null);
    setWalletSheetOpen(false);
    if (!isDemoMode) setBalanceG(0);
  };

  const balanceIsStale = Date.now() - balanceUpdatedAt > 1000 * 60 * 10;

  useEffect(() => {
    if (!walletAddress) return;

    const balanceBucket = balanceG >= 5000 ? '5k+' : balanceG >= 1000 ? '1k-5k' : balanceG >= 100 ? '100-1k' : 'under-100';
    emitAnalyticsEvent('balance_viewed', { balance_bucket: balanceBucket });

    if (currentTab === 'home') {
      emitAnalyticsEvent('readiness_viewed', {
        balance_bucket: balanceBucket,
        days_to_minimum_bucket: '36d',
        state: 'ready',
      });
    }
  }, [balanceG, currentTab, walletAddress]);

  const handleInitiateCashOut = (
    quote: QuoteResult,
    amountG: number,
    slippageBps: number,
    bankName?: string,
    accountNumber?: string,
    accountHolderName?: string,
    ngnPerUsdt?: number | null,
    bankCode?: string
  ) => {
    setPendingQuote({ quote, amountG, slippageBps, bankName, accountNumber, accountHolderName, ngnPerUsdt, bankCode });
    emitAnalyticsEvent('quote_shown', {
      amount: amountG,
      route: quote.route,
      price_impact: Number(quote.priceImpactBps),
      exit_contribution: 10,
      swap_fee: 0,
      ...(Number.isFinite(ngnPerUsdt) ? { estimated_naira: (Number(quote.usdtOut) / 1e6) * (ngnPerUsdt as number) } : {}),
    });
  };

  const handleRefreshQuote = async () => {
    if (!pendingQuote) return;
    const amountWei = gToWei(pendingQuote.amountG);
    try {
      const quote = LIVE_QUOTES ? await getLiveNetQuote(amountWei) : getNetQuote({ amountIn: amountWei });
      setPendingQuote((prev) => (prev ? { ...prev, quote } : prev));
    } catch {
      setSwapError("We couldn't get a live price right now. Please try again.");
    }
  };

  // One-tap cash out: ONE wallet confirmation swaps the G$ and pays the payout partner exactly what the order asks.
  // The order is created first, sized to the swap's guaranteed minimum. Any leftover dollars go back to the customer.
  const handleConfirmOneTap = async () => {
    if (!pendingQuote || !walletAddress) return;
    const wallet = walletAddress;
    const { amountG } = pendingQuote;
    let quote = pendingQuote.quote;

    setSwapError(null);
    setConfirmStage('order');
    setWalletStep({ kind: 'order', n: 0, total: 1 });
    emitAnalyticsEvent('swap_submitted', { amount: amountG, slippage_setting: 0.5, route: quote.route });

    let order: OneTapOrder | null = null;
    try {
      // Re-read live prices right before asking for the order, so the guaranteed minimum reflects the market now
      if (LIVE_QUOTES) {
        quote = await getLiveNetQuote(gToWei(amountG));
        if (Number(quote.usdtOut) / 1e6 < MIN_NET_USDT_REQUIRED) {
          throw new Error(`Minimum cash out is about ${getMinimumCashOutG().toLocaleString()} G$. Your amount is a little below it.`);
        }
      }
      if (await isOneTapRouterPaused()) {
        throw new Error('Cash out is paused right now. Nothing was sent. Please try again later.');
      }
      const minOut = computeOneTapMinOut(quote);
      order = await createOneTapOrder({
        minUsdt: `${minOut / 1_000_000n}.${(minOut % 1_000_000n).toString().padStart(6, '0')}`,
        amountG: String(Math.floor(amountG * 1e6) / 1e6),
        refundAddress: wallet,
        recipient: {
          institution: pendingQuote.bankCode || pendingQuote.bankName || '',
          accountIdentifier: pendingQuote.accountNumber || '',
          accountName: pendingQuote.accountHolderName || '',
          memo: 'GoodCash payout',
        },
      });

      setConfirmStage('swap');
      const placed = order;
      let result: { txHash: string; usdtOut: number; usdtPaid: number } | null = null;
      let unconfirmedHash: string | null = null;
      try {
        result = await executeOneTapCashOut({
          amountG,
          quote,
          minOut,
          walletAddress: wallet,
          order: placed,
          onStep: (info) => setWalletStep(info),
        });
      } catch (e) {
        // Sent to the network but not confirmed yet: it may still go through, so show progress rather than an error
        if (e instanceof SwapPendingError) unconfirmedHash = e.hash;
        else throw e;
      }

      const txHash = result?.txHash ?? unconfirmedHash ?? '';
      const naira = placed.expectedNaira && Number(placed.expectedNaira) > 0 ? Number(placed.expectedNaira) : undefined;
      setBalanceG((prev) => Math.max(0, prev - amountG));
      upsertHistory({
        id: `tx-${Date.now()}`,
        txHash,
        timestamp: Date.now(),
        amountInG: amountG,
        amountOutUsdt: result?.usdtOut ?? Number(quote.usdtOut) / 1e6,
        route: 'GoodCash one-tap',
        orderId: placed.orderId,
        nairaAmount: naira,
        steps: { swapped: result ? 'completed' : 'pending', sentToPartner: result ? 'completed' : 'pending', paidInNaira: 'pending' },
      });
      // The payment to the partner happened inside the same transaction, so nothing is left to pay by hand
      setTrackerData({
        txHash,
        usdtReceived: result?.usdtPaid ?? Number(placed.payAmountAtomic) / 1e6,
        amountGSwapped: amountG,
        bankName: pendingQuote.bankName || '',
        accountNumber: pendingQuote.accountNumber || '',
        accountHolderName: pendingQuote.accountHolderName || '',
        ngnPerUsdt: pendingQuote.ngnPerUsdt ?? null,
        orderId: placed.orderId,
        initialOrder: placed,
        depositSent: true,
      });
      if (txHash) void linkOneTapSwap(placed.orderId, txHash, wallet).catch(() => undefined);
      setConfirmResult({
        settled: false,
        paid: true,
        nairaText: naira ? `₦${Math.round(naira).toLocaleString()}` : '—',
        reference: null,
      });
      setConfirmStage(null);
    } catch (err: unknown) {
      setSwapError(friendlySwapError(err));
      if (!/user rejected|user denied|rejected the request/i.test(String((err as Error)?.message ?? ''))) {
        reportIssue('swap_failed', err, order ? { orderId: order.orderId } : {});
      }
      setConfirmStage(null);
      throw err;
    }
  };

  const handleConfirmSwap = async () => {
    if (!pendingQuote) return;
    if (!walletAddress) {
      setSwapError('Connect your wallet before cashing out.');
      return;
    }
    if (ONE_TAP_ENABLED && !isDemoMode) {
      // If the one-tap router is paused, fall back to the three-step flow so nobody is locked out
      const paused = await isOneTapRouterPaused().catch(() => false);
      if (chooseCashOutFlow(true, paused) === 'one-tap') return handleConfirmOneTap();
    }
    const refundAddress = walletAddress;
    const { amountG, slippageBps } = pendingQuote;
    let quote = pendingQuote.quote;

    setSwapError(null);
    setConfirmStage('swap');

    emitAnalyticsEvent('swap_submitted', {
      amount: amountG,
      slippage_setting: slippageBps / 100,
      route: quote.route,
    });

    try {
      // Re-read live prices right before sending, so the minimum payout reflects the market now
      if (LIVE_QUOTES) {
        quote = await getLiveNetQuote(gToWei(amountG));
        if (Number(quote.usdtOut) / 1e6 < MIN_NET_USDT_REQUIRED) {
          throw new Error(`Minimum cash out is about ${getMinimumCashOutG().toLocaleString()} G$. Your amount is a little below it.`);
        }
      }
      const swapResult = await executeRouterSwap({
        amountG,
        quote,
        slippageBps,
        walletAddress: refundAddress,
        isDemoMode,
        onStep: (info) => {
          stepTotalRef.current = info.total;
          setWalletStep(info);
        },
      });

      const realUsdtReceived = swapResult.usdtReceived;
      const realTxHash = swapResult.txHash;

      savePendingPayout({ txHash: realTxHash, usdtReceived: realUsdtReceived, amountG });
      setPendingSwapResult({ txHash: realTxHash, usdtReceived: realUsdtReceived, amountG });
      setConfirmStage('order');
      setWalletStep({ kind: 'order', n: 0, total: stepTotalRef.current });

      let order: OffRampOrder;
      try {
        order = await createPaycrestOrder({
          amountUsdt: paycrestOrderAmount(realUsdtReceived),
          usdtReceived: realUsdtReceived,
          swapTxHash: realTxHash,
          refundAddress,
          recipient: {
            institution: pendingQuote.bankCode || pendingQuote.bankName || '',
            accountIdentifier: pendingQuote.accountNumber || '',
            accountName: pendingQuote.accountHolderName || '',
            memo: 'GoodCash payout',
          },
        });
      } catch (orderErr: unknown) {
        setPendingSwapResult({ txHash: realTxHash, usdtReceived: realUsdtReceived, amountG });
        setSwapError(`Your swap went through, but the payout order couldn't be created yet. Your funds are safe in your wallet. Use Retry payout in a moment.`);
        setConfirmStage(null);
        return;
      }

      clearPendingPayout();
      setPendingSwapResult(null);

      setBalanceG((prev) => Math.max(0, prev - amountG));

      const newHistoryItem: SwapHistoryItem = {
        id: `tx-${Date.now()}`,
        txHash: realTxHash,
        timestamp: Date.now(),
        amountInG: amountG,
        amountOutUsdt: realUsdtReceived,
        route:
          quote.route === 'reserve'
            ? 'GoodDollar Reserve → Uniswap V3 (fee 100)'
            : 'Uniswap V3 (G$/USDm) → Uniswap V3 (USDm/USDT)',
        orderId: order.orderId,
        nairaAmount: order.expectedNaira && Number(order.expectedNaira) > 0 ? Number(order.expectedNaira) : undefined,
        steps: {
          swapped: 'completed',
          sentToPartner: 'pending',
          paidInNaira: 'pending',
        },
      };

      upsertHistory(newHistoryItem);

      emitAnalyticsEvent(
        'CashOut',
        decodeCashOutEvent({
          user: walletAddress ?? '0x0000000000000000000000000000000000000000',
          recipient: '0x0000000000000000000000000000000000000000',
          tokenOut: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
          amountIn: gToWei(amountG),
          amountOut: BigInt(Math.floor(realUsdtReceived * 1e6)),
          route: quote.route,
          ref: 'goodcash-ui',
          source: 'contract',
        })
      );

      setTrackerData({
        txHash: realTxHash,
        usdtReceived: realUsdtReceived,
        amountGSwapped: amountG,
        bankName: pendingQuote.bankName || '',
        accountNumber: pendingQuote.accountNumber || '',
        accountHolderName: pendingQuote.accountHolderName || '',
        ngnPerUsdt: pendingQuote.ngnPerUsdt ?? null,
        orderId: order.orderId,
        initialOrder: order,
      });

      // The customer never handles the dollar token: pay the partner automatically,
      // so their only wallet prompts are approve, convert and pay.
      setConfirmStage('pay');
      const paid = await autoPayDeposit(order, realUsdtReceived);

      const rate = pendingQuote.ngnPerUsdt ?? null;
      const naira = rate ? nairaFromUsdt(realUsdtReceived, rate) : null;
      setConfirmResult({
        settled: order.status === 'settled',
        paid: paid || order.status === 'settled',
        nairaText: naira !== null ? `₦${Math.round(naira).toLocaleString()}` : '—',
        reference: order.paymentReference ?? null,
      });
      setConfirmStage(null);
    } catch (err: unknown) {
      if (err instanceof SwapPendingError && walletAddress) {
        // The swap was sent but not confirmed yet. Keep watching for it, then offer to finish the payout.
        const hash = err.hash;
        const wallet = walletAddress;
        void (async () => {
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 6000));
            try {
              const found = await fetchSwapForRecovery(hash, wallet);
              savePendingPayout({ txHash: hash, usdtReceived: found.usdtReceived, amountG: found.amountG });
              setPendingSwapResult({ txHash: hash, usdtReceived: found.usdtReceived, amountG: found.amountG });
              return;
            } catch {
              // not confirmed yet
            }
          }
        })();
      }
      setSwapError(friendlySwapError(err));
      if (!/user rejected|user denied|rejected the request/i.test(String((err as Error)?.message ?? ''))) {
        reportIssue('swap_failed', err);
      }
      setConfirmStage(null);
      throw err;
    }
  };

  const handleRetryPayout = async () => {
    if (!pendingSwapResult || !pendingQuote) return;
    if (!walletAddress) {
      setSwapError('Connect your wallet before retrying the payout.');
      return;
    }
    setSwapError(null);

    try {
      const order = await createPaycrestOrder({
        amountUsdt: paycrestOrderAmount(pendingSwapResult.usdtReceived),
        usdtReceived: pendingSwapResult.usdtReceived,
        swapTxHash: pendingSwapResult.txHash,
        refundAddress: walletAddress,
        recipient: {
          institution: pendingQuote.bankCode || pendingQuote.bankName || '',
          accountIdentifier: pendingQuote.accountNumber || '',
          accountName: pendingQuote.accountHolderName || '',
          memo: 'GoodCash payout',
        },
      });

      const amountGSwapped = pendingSwapResult.amountG ?? 0;
      if (amountGSwapped > 0) {
        setBalanceG((prev) => Math.max(0, prev - amountGSwapped));
      }

      const newHistoryItem: SwapHistoryItem = {
        id: `tx-${Date.now()}`,
        txHash: pendingSwapResult.txHash,
        timestamp: Date.now(),
        amountInG: amountGSwapped,
        amountOutUsdt: pendingSwapResult.usdtReceived,
        route: pendingQuote.quote.route === 'reserve'
          ? 'GoodDollar Reserve \u2192 Uniswap V3 (fee 100)'
          : 'Uniswap V3 (G$/USDm) \u2192 Uniswap V3 (USDm/USDT)',
        orderId: order.orderId,
        nairaAmount: order.expectedNaira && Number(order.expectedNaira) > 0 ? Number(order.expectedNaira) : undefined,
        steps: { swapped: 'completed', sentToPartner: 'pending', paidInNaira: 'pending' },
      };
      upsertHistory(newHistoryItem);

      setTrackerData({
        txHash: pendingSwapResult.txHash,
        usdtReceived: pendingSwapResult.usdtReceived,
        amountGSwapped,
        bankName: pendingQuote.bankName || '',
        accountNumber: pendingQuote.accountNumber || '',
        accountHolderName: pendingQuote.accountHolderName || '',
        ngnPerUsdt: pendingQuote.ngnPerUsdt ?? null,
        orderId: order.orderId,
        initialOrder: order,
      });

      clearPendingPayout();
      stepTotalRef.current = 1;
      const recoveredUsdt = pendingSwapResult.usdtReceived;
      setPendingSwapResult(null);
      setConfirmStage('pay');
      const paidNow = await autoPayDeposit(order, recoveredUsdt);
      setConfirmStage(null);
      const rate = pendingQuote.ngnPerUsdt ?? null;
      setConfirmResult({
        settled: order.status === 'settled',
        paid: paidNow || order.status === 'settled',
        nairaText: rate ? `₦${Math.round(nairaFromUsdt(recoveredUsdt, rate)).toLocaleString()}` : '—',
        reference: order.paymentReference ?? null,
      });
    } catch (retryErr: unknown) {
      setSwapError(`We still couldn't set up your payout. Your funds are safe. Please try again in a moment.`);
    }
  };

  // Everything saved on this device (history, unfinished payout, tracker) belongs to one wallet.
  // If a different wallet connects, start clean so nobody sees or finishes someone else's cash out.
  useEffect(() => {
    if (!walletAddress || isDemoMode) return;
    const now = walletAddress.toLowerCase();
    try {
      const last = localStorage.getItem('goodcash_last_wallet');
      if (last && last !== now) {
        setHistory([]);
        setTrackerData(null);
        setPendingSwapResult(null);
        setPendingQuote(null);
        setConfirmResult(null);
        setMobileView('home');
        setCurrentTab('home');
        ['goodcash_history', 'goodcash_active_tracker', PENDING_PAYOUT_KEY, 'goodcash_pending_swap', DISMISSED_KEY].forEach((k) => localStorage.removeItem(k));
      }
      localStorage.setItem('goodcash_last_wallet', now);
    } catch {
      // optional convenience only
    }
  }, [walletAddress, isDemoMode]);

  // Follow the wallet: switching account or network inside it must never leave the app out of step
  useEffect(() => {
    if (isDemoMode || !walletAddress) return;
    return subscribeWalletEvents(
      (accounts) => {
        const next = accounts[0] ?? null;
        if (!next) {
          setWalletAddress(null);
          setWalletMessage('Your wallet was disconnected. Connect it again to continue.');
        } else if (next.toLowerCase() !== walletAddress.toLowerCase()) {
          setWalletAddress(next);
          setWalletMessage('You switched wallets. GoodCash is now showing the new one.');
        }
      },
      (chainId) => {
        if (chainId !== 42220) setWalletMessage("Your wallet isn't on the Celo network. We'll switch it for you when you cash out.");
      }
    );
  }, [walletAddress, isDemoMode]);

  // The payment window closed or the order can't be paid: drop it so a fresh payout is offered
  const handleOrderClosed = () => {
    setTrackerData(null);
    try { localStorage.removeItem('goodcash_active_tracker'); } catch { /* optional */ }
    setCurrentTab('home');
    setMobileView('home');
  };

  // Remove swaps the owner asked to scrap from this device's saved state
  useEffect(() => {
    setHistory((prev) => (prev.some((h) => isHiddenSwap(h.txHash)) ? prev.filter((h) => !isHiddenSwap(h.txHash)) : prev));
    if (pendingSwapResult && isHiddenSwap(pendingSwapResult.txHash)) {
      setPendingSwapResult(null);
      clearPendingPayout();
    }
    if (trackerData && isHiddenSwap(trackerData.txHash)) {
      setTrackerData(null);
      try { localStorage.removeItem('goodcash_active_tracker'); } catch { /* optional */ }
    }
  }, [pendingSwapResult, trackerData]);

  // Same wallet, same History on every device: pull this wallet's swaps from our service and merge them in
  useEffect(() => {
    if (isDemoMode || !walletAddress) return;
    let alive = true;
    const sync = () =>
      fetchWalletHistory(walletAddress)
        .then((server) => {
          if (alive) setHistory((prev) => mergeServerHistory(prev, server));
        })
        .catch(() => {});
    void sync();
    const iv = setInterval(sync, 180000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [walletAddress, isDemoMode]);

  // Repair history rows saved with 0 G$ (older recovery bug) by reading the swap back from Celo
  useEffect(() => {
    if (isDemoMode) return;
    const broken = history.filter((h) => !h.amountInG && h.txHash);
    if (broken.length === 0) return;
    let alive = true;
    broken.forEach((h) => {
      fetchSwapForRecovery(h.txHash)
        .then(({ amountG }) => {
          if (!alive || !amountG) return;
          setHistory((prev) => prev.map((x) => (x.id === h.id ? { ...x, amountInG: amountG } : x)));
        })
        .catch(() => {});
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.length]);

  // Announce each payout once only, on this device, however many times its status is re-checked
  const announcePaid = (key: string, naira: number | null) => {
    const id = key.toLowerCase();
    try {
      const seen = JSON.parse(localStorage.getItem('goodcash_announced') ?? '[]') as string[];
      if (seen.includes(id)) return;
      localStorage.setItem('goodcash_announced', JSON.stringify([...seen, id].slice(-40)));
    } catch {
      // if storage is unavailable, fall through and announce
    }
    setOkNotice(
      naira
        ? `Your ${formatNaira(naira)} has been sent. It can take a few minutes to show in your bank.`
        : 'Your naira has been sent. It can take a few minutes to show in your bank.'
    );
  };

  const historyRef = useRef(history);
  historyRef.current = history;
  const liveNgnRateRef = useRef<number | null>(null);
  liveNgnRateRef.current = liveNgnRate;

  // Keep History honest without the customer opening anything: ask which order belongs to each unpaid swap
  const unpaidSwapKey = history
    .filter((h) => h.steps?.paidInNaira !== 'completed' && h.txHash)
    .map((h) => h.txHash.toLowerCase())
    .slice(0, 6)
    .join(',');
  useEffect(() => {
    if (isDemoMode || !unpaidSwapKey) return;
    let alive = true;
    const check = async () => {
      for (const hash of unpaidSwapKey.split(',')) {
        try {
          const res = await fetch(`${ORDERS_API_BASE}/swaps/${hash}`);
          if (!res.ok) continue;
          const data = (await res.json()) as { orderId?: string; status?: string };
          if (alive && (data.status === 'settled' || data.status === 'validated')) {
            const row = historyRef.current.find((h) => h.txHash.toLowerCase() === hash);
            const naira = row ? getHistoryNaira(row, liveNgnRateRef.current) : null;
            announcePaid(data.orderId ?? hash, naira);
            setHistory((prev) =>
              prev.map((h) =>
                h.txHash.toLowerCase() === hash
                  ? { ...h, orderId: data.orderId ?? h.orderId, steps: { swapped: 'completed', sentToPartner: 'completed', paidInNaira: 'completed' } }
                  : h
              )
            );
          }
        } catch {
          // try again at the next check
        }
      }
    };
    void check();
    const iv = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [unpaidSwapKey, isDemoMode]);

  const handleTrackerSettled = ({ orderId, nairaAmount }: { orderId: string; nairaAmount: number | null }) => {
    announcePaid(orderId, nairaAmount);
    setHistory((prev) =>
      prev.map((h) =>
        h.orderId === orderId
          ? {
              ...h,
              ...(nairaAmount !== null ? { nairaAmount } : {}),
              steps: { swapped: 'completed', sentToPartner: 'completed', paidInNaira: 'completed' },
            }
          : h
      )
    );
  };

  // Right before paying, ask our server whether this order can still be paid. Fails closed.
  const orderPayableCheck = (orderId: string, to: string, amount: string) => async () => {
    let d: Awaited<ReturnType<typeof fetchOrderDetails>>;
    try {
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error('bad id');
      d = await fetchOrderDetails(orderId);
    } catch {
      throw new Error('ORDER_UNKNOWN');
    }
    if (d.status !== 'initiated') {
      throw new Error(['expired', 'refunded', 'cancelled', 'error'].includes(d.status) ? 'ORDER_EXPIRED' : 'ORDER_ALREADY_PAID');
    }
    if (!d.receiveAddress || d.receiveAddress.toLowerCase() !== to.toLowerCase()) throw new Error('ORDER_MISMATCH');
    if (d.amountToSend && Math.abs(Number(d.amountToSend) - Number(amount)) > 0.000001) throw new Error('ORDER_MISMATCH');
    if (d.validUntil && new Date(d.validUntil).getTime() - Date.now() < 60_000) throw new Error('ORDER_EXPIRED');
  };

  // Pays the payout partner automatically after an order is created. Returns true if the payment went through.
  const autoPayDeposit = async (order: OffRampOrder, usdtReceived: number): Promise<boolean> => {
    if (isDemoMode || !walletAddress || order.status === 'settled' || !order.receiveAddress) return false;
    setWalletStep({ kind: 'pay', n: stepTotalRef.current, total: stepTotalRef.current });
    try {
      await sendUsdtDeposit({
        from: walletAddress,
        to: order.receiveAddress,
        amount: order.amountToSend,
        maxAmount: usdtReceived,
        orderId: order.orderId,
        checkOrder: orderPayableCheck(order.orderId, order.receiveAddress, order.amountToSend),
      });
      setTrackerData((prev) => (prev ? { ...prev, depositSent: true } : prev));
      return true;
    } catch (e) {
      // Sent but not yet confirmed: it will land, so never offer a second payment
      if (e instanceof DepositPendingError) {
        setTrackerData((prev) => (prev ? { ...prev, depositSent: true } : prev));
        return true;
      }
      return false; // cancelled or failed: the tracker offers "Pay now"
    } finally {
      setWalletStep(null);
    }
  };

  // One-tap USDT deposit to Paycrest from the connected wallet (never more than the swap produced)
  const sendDeposit =
    walletAddress && trackerData
      ? async (to: string, amount: string, orderId: string) => {
          await sendUsdtDeposit({
            from: walletAddress,
            to,
            amount,
            maxAmount: trackerData.usdtReceived,
            orderId,
            checkOrder: orderPayableCheck(orderId, to, amount),
          });
        }
      : undefined;

  // Automatically find a swap that went through but was never paid out, so nobody has to dig for a transaction hash.
  useEffect(() => {
    if (isDemoMode || !walletAddress || pendingSwapResult || trackerData || pendingQuote) return;
    let alive = true;
    (async () => {
      try {
        const swaps = await fetchUnfinishedSwaps(walletAddress);
        const dismissed = readDismissedSwaps();
        for (const sw of swaps) {
          if (dismissed.has(sw.txHash.toLowerCase()) || isHiddenSwap(sw.txHash)) continue;
          if (sw.usdtReceived < MIN_NET_USDT_REQUIRED) continue; // too small to pay out
          const balance = await fetchUsdtBalance(walletAddress);
          if (balance < sw.usdtReceived - 0.011) continue; // the money has already been used elsewhere
          if (!alive) return;
          savePendingPayout({ txHash: sw.txHash, usdtReceived: sw.usdtReceived, amountG: sw.amountG });
          setPendingSwapResult({ txHash: sw.txHash, usdtReceived: sw.usdtReceived, amountG: sw.amountG });
          return;
        }
      } catch {
        // Nothing to offer if the check fails; the customer can still cash out normally
      }
    })();
    return () => {
      alive = false;
    };
  }, [walletAddress, pendingSwapResult, trackerData, pendingQuote, isDemoMode]);

  const handleFinishPendingPayout = async (
    bankCode: string,
    bankName: string,
    accountNumber: string,
    accountHolderName: string
  ) => {
    if (!pendingSwapResult) return;
    if (!walletAddress) {
      setSwapError('Connect your wallet before finishing the payout.');
      return;
    }
    setSwapError(null);

    try {
      const order = await createPaycrestOrder({
        amountUsdt: paycrestOrderAmount(pendingSwapResult.usdtReceived),
        usdtReceived: pendingSwapResult.usdtReceived,
        swapTxHash: pendingSwapResult.txHash,
        refundAddress: walletAddress,
        recipient: {
          institution: bankCode,
          accountIdentifier: accountNumber,
          accountName: accountHolderName,
          memo: 'GoodCash payout',
        },
      });

      const amountGSwapped = pendingSwapResult.amountG ?? 0;
      if (amountGSwapped > 0) {
        setBalanceG((prev) => Math.max(0, prev - amountGSwapped));
      }

      const newHistoryItem: SwapHistoryItem = {
        id: `tx-${Date.now()}`,
        txHash: pendingSwapResult.txHash,
        timestamp: Date.now(),
        amountInG: amountGSwapped,
        amountOutUsdt: pendingSwapResult.usdtReceived,
        route: 'On-chain swap (confirmed)',
        orderId: order.orderId,
        nairaAmount: order.expectedNaira && Number(order.expectedNaira) > 0 ? Number(order.expectedNaira) : undefined,
        steps: { swapped: 'completed', sentToPartner: 'pending', paidInNaira: 'pending' },
      };
      upsertHistory(newHistoryItem);

      setTrackerData({
        txHash: pendingSwapResult.txHash,
        usdtReceived: pendingSwapResult.usdtReceived,
        amountGSwapped,
        bankName,
        accountNumber,
        accountHolderName,
        ngnPerUsdt: null,
        orderId: order.orderId,
        initialOrder: order,
      });

      clearPendingPayout();
      stepTotalRef.current = 1;
      const recoveredUsdt = pendingSwapResult.usdtReceived;
      setPendingSwapResult(null);
      setPendingQuote(null);
      // Stay on the cash out tab to show the tracker, and pay the partner automatically
      await autoPayDeposit(order, recoveredUsdt);
    } catch (retryErr: unknown) {
      setSwapError(`We still couldn't set up your payout. Your funds are safe. Please try again in a moment.`);
    }
  };

  if (miniPayBlocked) {
    return (
      <div className="relative min-h-screen w-full bg-[#120e20] text-white flex flex-col items-center justify-center px-4 py-10 font-sans">
        <div className="absolute inset-0 bg-gradient-to-b from-[#120e20] via-[#18122c] to-[#0e0a1a]" />
        <div className="relative z-10 w-full max-w-2xl">
          <MiniPayNotice language={language} />
        </div>
      </div>
    );
  }

  return (
    <div className="gc min-h-screen flex flex-col">
      {/* Notices live at the very top so phones and desktops both see them (the desktop layout is hidden on phones) */}
      {walletAddress && ((pendingSwapResult && !pendingQuote && !trackerData && mobileView !== 'finish') ||
        (trackerData && !trackerData.depositSent && mobileView !== 'processing' && mobileView !== 'success')) && currentTab !== 'cashout' && (mobileView === 'home' || mobileView === 'history') && (
        <button
          type="button"
          className="gc-note gc-banner fixed left-1/2 z-[150] w-[min(92vw,420px)] -translate-x-1/2 bottom-[96px] md:bottom-auto md:top-3"
          onClick={() => {
            setCurrentTab('cashout');
            setMobileView(trackerData ? 'processing' : 'finish');
          }}
          style={{ background: '#ffd23f', textAlign: 'left', cursor: 'pointer' }}
        >
          <b>You have an unfinished cash out.</b> Tap to finish getting your naira.
        </button>
      )}

      {magicOpen && (
        <React.Suspense fallback={null}>
          <MagicConnect onConnected={onMagicConnected} onError={onMagicError} onClose={() => setMagicOpen(false)} />
        </React.Suspense>
      )}

      {addOpen && walletAddress && (
        <React.Suspense fallback={null}>
          <AddGsModal
            wallet={walletAddress}
            onClose={() => setAddOpen(false)}
            onArrived={() => {
              void fetchGBalance(walletAddress).then((b) => setBalanceG(Math.floor(b * 100) / 100)).catch(() => {});
            }}
          />
        </React.Suspense>
      )}
      {walletSheetOpen && walletAddress && (
        <Modal
          label="Your wallet"
          title="Your wallet"
          onClose={() => setWalletSheetOpen(false)}
          z={120}
          footer={
            <button type="button" className="gc-btn gc-btn--white gc-hit" onClick={handleDisconnectWallet}>
              Disconnect wallet
            </button>
          }
        >
          <div className="gc-card">
            <div className="gc-lab">Connected</div>
            <div className="font-mono break-all select-all" style={{ fontSize: 12, marginTop: 4 }}>{walletAddress}</div>
          </div>
          <p className="gc-sm" style={{ margin: 0 }}>
            Disconnecting only signs GoodCash out of this wallet on this device. Your money stays in your wallet.
          </p>
        </Modal>
      )}

      {walletStep && walletStepTitle && (
        <Modal label="Wallet confirmation" title={walletStepTitle} onClose={() => setWalletStep(null)} z={210}>
          <p className="gc-sm" style={{ margin: 0, fontWeight: 800, fontSize: 16 }}>{walletStepBody}</p>
          {walletStep.kind !== 'order' && (
            <p className="gc-sm" style={{ margin: 0 }}>
              {phoneWallet
                ? `Tap the button, confirm in ${walletName}, then come back to this page. It carries on by itself.`
                : `Confirm in your wallet. This page carries on by itself.`}
            </p>
          )}
          {phoneWallet && walletStep.kind !== 'order' && (
            <button type="button" className="gc-btn gc-hit" onClick={openWalletApp}>
              Open {phoneWallet.name}
            </button>
          )}
        </Modal>
      )}

      {okNotice && (
        <div
          role="status"
          className="gc-note fixed left-1/2 z-[200] w-[min(92vw,420px)] -translate-x-1/2 bottom-[96px] md:bottom-auto md:top-3"
          onClick={() => setOkNotice(null)}
          style={{ background: '#8cf0c0', cursor: 'pointer', fontWeight: 800 }}
        >
          ✓ {okNotice}
        </div>
      )}

      {walletMessage && (
        <div
          role="alert"
          className="gc-note fixed left-1/2 z-[200] w-[min(92vw,420px)] -translate-x-1/2 bottom-[96px] md:bottom-auto md:top-3"
          onClick={() => setWalletMessage(null)}
          style={{ background: '#ff9b9b', cursor: 'pointer' }}
        >
          {walletMessage}
        </div>
      )}

      {/* ── Desktop Layout ── */}
      <div className="hidden md:flex flex-col flex-1">
      <Navbar
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          setTrackerData(null);
        }}
        walletAddress={walletAddress}
        onConnectWallet={handleConnectWallet}
        onDisconnectWallet={handleDisconnectWallet}
        language={language}
        isMiniPayBlocked={miniPayBlocked}
        isDemoMode={isDemoMode}
      />

      <main className="gc-main">
        <div className="gc-mobile-only" style={{ width: '100%', maxWidth: '420px', margin: '0 auto' }}>
          <SafetyBanner language={language} />
        </div>

        <div className="gc-col pb-24">
          {currentTab === 'home' ? (
            <ReadinessCard
              balanceG={balanceG}
              dailyClaimG={123.48}
              onCashOutClick={() => setCurrentTab('cashout')}
              onAddClick={ADDG_ENABLED ? handleAddClick : undefined}
              feeNote={networkFee && !networkFee.enough ? `You also need about ${celoText(networkFee.needCelo)} CELO in your wallet to pay the network fee. G$ can't pay it, so top up a little CELO before cashing out.` : null}
              language={language}
              isStale={balanceIsStale}
              ngnPerUsdt={liveNgnRate}
            />
          ) : currentTab === 'cashout' ? (
            <>
              {trackerData && !pendingQuote ? (
                <CashOutTracker
                  txHash={trackerData.txHash}
                  usdtReceived={trackerData.usdtReceived}
                  amountGSwapped={trackerData.amountGSwapped}
                  bankName={trackerData.bankName ?? ''}
                  accountNumber={trackerData.accountNumber ?? ''}
                  accountHolderName={trackerData.accountHolderName ?? ''}
                  ngnPerUsdt={trackerData.ngnPerUsdt}
                  initialOrder={trackerData.initialOrder ?? (trackerData.orderId ? { orderId: trackerData.orderId } : undefined)}
                  walletAddress={walletAddress ?? '0x0000000000000000000000000000000000000000'}
                  language={language}
                  onSettled={handleTrackerSettled}
                  onSendDeposit={sendDeposit}
                  onOrderClosed={handleOrderClosed}
                  depositSent={trackerData.depositSent}
                  onDone={() => {
                    setTrackerData(null);
                    setCurrentTab('home');
                  }}
                  onCancel={() => {
                    // Clear all tracker state
                    setTrackerData(null);
                    setPendingSwapResult(null);
                    setPendingQuote(null);
                    clearPendingPayout();
                    // Clear ALL stale localStorage entries
                    if (typeof localStorage !== 'undefined') {
                      localStorage.removeItem('goodcash_active_tracker');
                      localStorage.removeItem('goodcash_pending_payout');
                      localStorage.removeItem('goodcash_pending_swap');
                    }
                    // Reset to standard cash out view
                    setCurrentTab('cashout');
                    setMobileView('home');
                  }}
                />
              ) : pendingSwapResult && !pendingQuote ? (
                <PendingPayoutCard
                  txHash={pendingSwapResult.txHash}
                  usdtReceived={pendingSwapResult.usdtReceived}
                  onRetry={handleFinishPendingPayout}
                  onCancel={() => {
                    if (pendingSwapResult) dismissSwap(pendingSwapResult.txHash);
                    // Clear all tracker state
                    setTrackerData(null);
                    setPendingSwapResult(null);
                    setPendingQuote(null);
                    // Clear ALL stale localStorage entries
                    if (typeof localStorage !== 'undefined') {
                      localStorage.removeItem('goodcash_active_tracker');
                      localStorage.removeItem('goodcash_pending_payout');
                      localStorage.removeItem('goodcash_pending_swap');
                    }
                    // Reset to standard cash out view
                    setCurrentTab('cashout');
                    setMobileView('home');
                  }}
                  errorMessage={swapError}
                  language={language}
                />
              ) : (
                <>
                <CashOutCard
                  balanceG={balanceG}
                  onInitiateCashOut={handleInitiateCashOut}
                  language={language}
                  activeCashOutAmount={activeCashOutAmount}
                  setActiveCashOutAmount={setActiveCashOutAmount}
                  savedBankDetails={savedBankDetails}
                  setSavedBankDetails={setSavedBankDetails}
                  ngnPerUsdt={liveNgnRate}
                  onPreviewUsdtChange={setPreviewUsdt}
                  walletConnected={Boolean(walletAddress)}
                  onConnectWallet={handleConnectWallet}
                />
                </>
              )}
            </>
          ) : currentTab === 'history' ? (
            <HistoryCard
              history={history}
              onCashOutClick={() => setCurrentTab('cashout')}
              language={language}
              ngnPerUsdt={pendingQuote?.ngnPerUsdt ?? liveNgnRate}
              walletAddress={walletAddress}
            />
          ) : null}
        </div>

        <aside className="gc-side">
          {currentTab === 'home' && (
            <>
              <div className="gc-card">
                <div className="gc-lab">{t.howItWorks}</div>
                <div className="gc-st">
                  <b className="gc-st__num">1</b>
                  <span className="gc-sm">{t.howItWorksStep1}</span>
                </div>
                <div className="gc-st">
                  <b className="gc-st__num">2</b>
                  <span className="gc-sm">{t.howItWorksStep2}</span>
                </div>
                <div className="gc-st">
                  <b className="gc-st__num">3</b>
                  <span className="gc-sm">{t.howItWorksStep3}</span>
                </div>
              </div>
              <div className="gc-card">
                <div className="gc-lab">{t.whatItCostsPanel}</div>
                <div className="gc-sm" style={{ marginTop: '4px' }}>
                  {t.whatItCostsExplanation}
                </div>
              </div>
              <div className="gc-card gc-card--mint">
                <div className="gc-lab">{t.staySafe}</div>
                <div className="gc-sm" style={{ marginTop: '4px' }}>
                  {t.staySafeText}{' '}
                  <a
                    href={BLOCKSCOUT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gc-inter"
                    style={{ color: '#111', textDecoration: 'underline' }}
                  >
                    Contract 0xA433…c407 ↗
                  </a>
                </div>
              </div>
            </>
          )}

          {currentTab === 'cashout' && (
            <>
              <div className="gc-card">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold uppercase text-[#111]">WHAT YOU'LL PAY</h3>
                </div>
                <div className="gc-row border-b-2 border-dashed border-[#d4c5fb] pt-3 pb-3">
                  <span>GoodDollar contribution (10%)</span>
                  <span className="bg-[#ffd23f] px-2 py-0.5 rounded text-[#111] font-medium">−100 G$</span>
                </div>
                <div className="gc-row border-b-2 border-dashed border-[#d4c5fb] pt-3 pb-3">
                  <span>Network fee</span>
                  <span>under $0.001</span>
                </div>
                <div className="gc-row pt-3 pb-3">
                  <span>You get at least</span>
                  <span>
                    {(() => {
                      const usdt = pendingQuote?.quote
                        ? Number(pendingQuote.quote.usdtOut) / 1e6
                        : trackerData?.usdtReceived ?? pendingSwapResult?.usdtReceived ?? previewUsdt;
                      return usdt !== null && Number.isFinite(usdt) ? `≈ $${usdt.toFixed(2)}` : '—';
                    })()}
                  </span>
                </div>
              </div>
              <div className="gc-card">
                <div className="gc-lab">{t.routeTitle}</div>
                <div className="gc-sm" style={{ marginTop: '4px' }}>
                  {t.routeExplanation}{' '}
                  <span style={{ textDecoration: 'underline', cursor: 'pointer' }}>{t.details}</span>
                </div>
              </div>
              <div className="gc-card gc-card--ye">
                <div className="gc-lab">{t.goodToKnowTitle}</div>
                <div className="gc-sm" style={{ marginTop: '4px' }}>
                  {t.goodToKnowText}
                </div>
              </div>
            </>
          )}

          {currentTab === 'history' && (
            <>
              <div className="gc-card gc-cost">
                <div className="gc-lab" style={{ marginBottom: '2px' }}>{t.yourTotals}</div>
                <div className="gc-row">
                  <span>{t.totalCashOuts}</span>
                  <span>{history.length}</span>
                </div>
                <div className="gc-row">
                  <span>{t.totalGSwapped}</span>
                  <span>
                    {history.reduce((sum, item) => sum + (item.amountInG || 0), 0).toLocaleString()} G$
                  </span>
                </div>
                <div className="gc-row">
                  <span>{t.totalNairaReceived}</span>
                  <span>
                    {(() => {
                      const total = history.reduce((sum, item) => {
                        const naira = item.nairaAmount ?? (item.steps?.paidInNaira === 'completed' ? getHistoryNaira(item, pendingQuote?.ngnPerUsdt ?? liveNgnRate) ?? 0 : 0);
                        return sum + (Number.isFinite(naira) ? naira : 0);
                      }, 0);
                      return Number.isFinite(total) && total > 0 ? `₦${Math.round(total).toLocaleString()}` : '—';
                    })()}
                  </span>
                </div>
              </div>
              <div className="gc-card">
                <div className="gc-lab">{t.whatStatusesMean}</div>
                <div className="gc-st">
                  <b className="gc-st__num">1</b>
                  <span className="gc-sm"><u>On its way</u>: {t.statusOnItsWayExplanation.replace(/^[^:]*:\s*/, '')}</span>
                </div>
                <div className="gc-st">
                  <b className="gc-st__num">2</b>
                  <span className="gc-sm"><u>Paid</u>: {t.statusPaidExplanation.replace(/^[^:]*:\s*/, '')}</span>
                </div>
              </div>
              <div className="gc-card gc-card--mint">
                <div className="gc-lab">{t.receiptsTitle}</div>
                <div className="gc-sm" style={{ marginTop: '4px' }}>
                  {t.receiptsExplanation}
                </div>
              </div>
            </>
          )}
        </aside>
      </main>

      {showPrivacy && (
        <div style={{ width: '100%', maxWidth: '420px', margin: '0 auto 10px', padding: '0 14px' }}>
          <div
            className="gc-note"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div>
              <strong>{t.privacyTitle}:</strong> {t.privacyText}
            </div>
            <button
              type="button"
              onClick={() => setShowPrivacy(false)}
              aria-label="Close privacy note"
              className="gc-hit"
              style={{
                background: 'transparent',
                border: 'none',
                font: '800 13px Inter',
                cursor: 'pointer',
                padding: '2px 6px',
                color: '#111',
                flex: 'none',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {pendingQuote && (
        <ConfirmModal
          isOpen={true}
          stage={confirmStage}
          result={confirmResult}
          onFinish={() => {
            // Settled: back to a fresh cash-out page. Otherwise hand over to the payout tracker.
            if (confirmResult?.settled) setTrackerData(null);
            setConfirmResult(null);
            setPendingQuote(null);
          }}
          onClose={() => { setPendingQuote(null); setPendingSwapResult(null); setConfirmResult(null); setConfirmStage(null); }}
          onConfirm={handleConfirmSwap}
          onRefresh={handleRefreshQuote}
          onRetryPayout={pendingSwapResult ? handleRetryPayout : undefined}
          quote={pendingQuote.quote}
          amountG={pendingQuote.amountG}
          slippageBps={pendingQuote.slippageBps}
          language={language}
          bankName={pendingQuote.bankName}
          accountNumber={pendingQuote.accountNumber}
          accountHolderName={pendingQuote.accountHolderName}
          ngnPerUsdt={pendingQuote.ngnPerUsdt}
          errorMessage={swapError}
          hasConfirmedSwap={!!pendingSwapResult}
          networkFee={networkFee}
        />
      )}

      <footer className="mt-auto flex justify-between items-center w-full bg-white border-t-4 border-[#111] px-6 py-4 text-xs">
        <span className="font-bold text-[#111]">{t.footerText}</span>
        <div className="flex items-center gap-4">
          <a
            href={BLOCKSCOUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#111] hover:text-[#111]/80 text-decoration-none font-bold"
          >
            {t.contractLinkText}
          </a>
          <span className="text-[#111] font-bold">·</span>
          <a
            href="https://gooddollar.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#111] hover:text-[#111]/80 text-decoration-none font-bold"
          >
            {t.goodDollarLinkText}
          </a>
          <span className="text-[#111] font-bold">·</span>
          <a
            href="https://paycrest.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#111] hover:text-[#111]/80 text-decoration-none font-bold"
          >
            {t.paycrestLinkText}
          </a>
          <span className="text-[#111] font-bold">·</span>
          <a href="/about" target="_blank" rel="noopener noreferrer" className="text-[#111] hover:text-[#111]/80 text-decoration-none font-bold">About</a>
          <span className="text-[#111] font-bold">·</span>
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#111] hover:text-[#111]/80 text-decoration-none font-bold">Privacy</a>
          <span className="text-[#111] font-bold">·</span>
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-[#111] hover:text-[#111]/80 text-decoration-none font-bold">Terms</a>
          <span className="text-[#111] font-bold">·</span>
          <button
            type="button"
            onClick={() => setShowPrivacy((v) => !v)}
            className="text-[#111] hover:text-[#111]/80 font-bold bg-transparent border-none p-0 cursor-pointer"
          >
            {t.privacyLinkText}
          </button>
        </div>
      </footer>
      {/* ── End Desktop Layout ── */}
      </div>

      {/* ── Mobile Shell ── */}
      <div className="gc--mobile-shell md:!hidden w-full bg-[#d4c5fb] relative">
        {/* Debug Panel - Only visible in development */}
        {isDemoMode && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug') && (
          <div className="fixed bottom-24 right-2 z-[100] bg-black/80 text-white p-2 rounded-lg text-xs">
            <div className="font-bold mb-1">Debug Views:</div>
            <div className="flex flex-col gap-1">
              <button onClick={() => setMobileView('home')} className="bg-white/20 px-2 py-1 rounded hover:bg-white/30">Home</button>
              <button onClick={() => setMobileView('cashout')} className="bg-white/20 px-2 py-1 rounded hover:bg-white/30">Cash Out</button>
              <button onClick={() => setMobileView('review')} className="bg-white/20 px-2 py-1 rounded hover:bg-white/30">Review</button>
              <button onClick={() => setMobileView('processing')} className="bg-white/20 px-2 py-1 rounded hover:bg-white/30">Processing</button>
              <button onClick={() => setMobileView('success')} className="bg-white/20 px-2 py-1 rounded hover:bg-white/30">Success</button>
            </div>
          </div>
        )}
        
        {mobileView === 'cashout' ? (
          <MobileCashOut
            balanceG={balanceG}
            ngnPerUsdt={liveNgnRate ?? pendingQuote?.ngnPerUsdt ?? 1452.6}
            onClose={() => setMobileView('home')}
            onReview={async (amountG: number, nairaEstimate: number | null, usdtEstimate: number) => {
              // Create quote (live on-chain prices in production) and go to the review view
              let quote: QuoteResult;
              try {
                const amountWei = gToWei(amountG);
                quote = LIVE_QUOTES ? await getLiveNetQuote(amountWei) : getNetQuote({ amountIn: amountWei });
                if (LIVE_QUOTES && Number(quote.usdtOut) / 1e6 < MIN_NET_USDT_REQUIRED) {
                  setWalletMessage(`Minimum cash out is about ${getMinimumCashOutG().toLocaleString()} G$. Your amount is a little below it.`);
                  return;
                }
              } catch {
                setWalletMessage("We couldn't get a live price right now. Please try again.");
                return;
              }
              setPendingQuote({
                quote,
                amountG,
                slippageBps: 100, // 1% default slippage
                ngnPerUsdt: nairaEstimate && usdtEstimate > 0 ? nairaEstimate / usdtEstimate : null,
              });
              setMobileView('review');
            }}
          />
        ) : mobileView === 'review' ? (
          <MobileReviewView
            amountG={pendingQuote?.amountG ?? null}
            nairaEstimate={
              pendingQuote?.quote && pendingQuote.ngnPerUsdt
                ? nairaFromUsdt(Number(pendingQuote.quote.usdtOut) / 1e6, pendingQuote.ngnPerUsdt)
                : null
            }
            usdtEstimate={pendingQuote?.quote ? Number(pendingQuote.quote.usdtOut) / 1e6 : null}
            oneTap={ONE_TAP_ENABLED && !oneTapPaused}
            networkFee={networkFee}
            ngnPerUsd={pendingQuote?.ngnPerUsdt ?? liveNgnRate}
            onBack={() => setMobileView('cashout')}
            onConfirm={async () => {
              try {
                await handleConfirmSwap();
                setMobileView('processing');
              } catch {
                // error text is already in swapError and shown on the review screen
              }
            }}
            errorMessage={swapError}
            activeCashOutAmount={activeCashOutAmount}
            setActiveCashOutAmount={setActiveCashOutAmount}
            savedBankDetails={savedBankDetails}
            setSavedBankDetails={setSavedBankDetails}

            onBankSaved={(b) =>
              setPendingQuote((prev) =>
                prev
                  ? {
                      ...prev,
                      bankName: b?.bankName,
                      bankCode: b?.bankCode,
                      accountNumber: b?.accountNumber,
                      accountHolderName: b?.accountName,
                    }
                  : prev
              )
            }
          />
        ) : mobileView === 'processing' && trackerData && (!trackerData.initialOrder || (trackerData.initialOrder.status !== 'settled' && trackerData.initialOrder.status !== 'validated')) ? (
          <div className="gc fixed inset-0 z-40 overflow-y-auto">
            <div className="gc-col" style={{ padding: '14px 14px 40px' }}>
              <button
                type="button"
                className="gc-pill gc-pill--white gc-hit"
                onClick={() => setMobileView('home')}
                style={{ alignSelf: 'flex-start' }}
              >
                ← Back to home
              </button>
              <CashOutTracker
                txHash={trackerData.txHash}
                usdtReceived={trackerData.usdtReceived}
                amountGSwapped={trackerData.amountGSwapped}
                bankName={trackerData.bankName ?? ''}
                accountNumber={trackerData.accountNumber ?? ''}
                accountHolderName={trackerData.accountHolderName ?? ''}
                ngnPerUsdt={trackerData.ngnPerUsdt}
                initialOrder={trackerData.initialOrder ?? (trackerData.orderId ? { orderId: trackerData.orderId } : undefined)}
                walletAddress={walletAddress ?? '0x0000000000000000000000000000000000000000'}
                language={language}
                onSettled={handleTrackerSettled}
                onSendDeposit={sendDeposit}
                onOrderClosed={handleOrderClosed}
                depositSent={trackerData.depositSent}
                onDone={() => {
                  setTrackerData(null);
                  setPendingQuote(null);
                  setConfirmResult(null);
                  setMobileView('home');
                }}
              />
            </div>
          </div>
        ) : mobileView === 'processing' ? (
          <MobileProcessingView
            amountG={pendingQuote?.amountG ?? trackerData?.amountGSwapped ?? null}
            nairaEstimate={
              pendingQuote?.quote && pendingQuote.ngnPerUsdt
                ? nairaFromUsdt(Number(pendingQuote.quote.usdtOut) / 1e6, pendingQuote.ngnPerUsdt)
                : trackerData?.ngnPerUsdt
                ? nairaFromUsdt(trackerData.usdtReceived, trackerData.ngnPerUsdt)
                : null
            }
            usdtEstimate={pendingQuote?.quote ? Number(pendingQuote.quote.usdtOut) / 1e6 : trackerData?.usdtReceived ?? null}
            txHash={trackerData?.txHash}
            onClose={() => setMobileView('home')}
            onBackToHome={() => setMobileView('home')}
          />
        ) : mobileView === 'success' ? (
          <MobileSuccessView
            nairaEstimate={
              pendingQuote?.quote && pendingQuote.ngnPerUsdt
                ? nairaFromUsdt(Number(pendingQuote.quote.usdtOut) / 1e6, pendingQuote.ngnPerUsdt)
                : trackerData?.ngnPerUsdt
                ? nairaFromUsdt(trackerData.usdtReceived, trackerData.ngnPerUsdt)
                : null
            }
            onClose={() => {
              setTrackerData(null);
              setPendingQuote(null);
              setConfirmResult(null);
              setMobileView('home');
            }}
            onViewTransaction={() => {
              if (trackerData?.txHash) window.open(`https://celo.blockscout.com/tx/${trackerData.txHash}`, '_blank', 'noopener,noreferrer');
            }}
          />
        ) : mobileView === 'finish' && pendingSwapResult ? (
          <div className="gc fixed inset-0 z-40 overflow-y-auto">
            <div className="gc-col" style={{ padding: '14px 14px 40px' }}>
              <button
                type="button"
                className="gc-pill gc-pill--white gc-hit"
                onClick={() => setMobileView('home')}
                style={{ alignSelf: 'flex-start' }}
              >
                ← Back to home
              </button>
              <PendingPayoutCard
                txHash={pendingSwapResult.txHash}
                usdtReceived={pendingSwapResult.usdtReceived}
                onRetry={handleFinishPendingPayout}
                onCancel={() => {
                  dismissSwap(pendingSwapResult.txHash);
                  setPendingSwapResult(null);
                  clearPendingPayout();
                  setMobileView('home');
                }}
                errorMessage={swapError}
                language={language}
              />
            </div>
          </div>
        ) : mobileView === 'history' ? (
          <MobileHistoryView
            history={history}
            ngnPerUsdt={liveNgnRate}
            walletAddress={walletAddress}
            onClose={() => setMobileView('home')}
            onNavigate={(tab) => setMobileView(tab)}
          />
        ) : (
          <>
            {/* Mobile Header */}
            <div className="gc-top">
              <div className="flex items-center gap-2">
                <span className="gc-logo text-[#111]">GoodCash</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="gc-chip text-[#111]"
                  onClick={walletAddress ? () => setWalletSheetOpen(true) : handleConnectWallet}
                >
                  {walletAddress ? walletAddress.slice(0, 6) + '…' + walletAddress.slice(-4) + ' ▾' : 'Connect wallet'}
                </button>
              </div>
            </div>

            {/* Mobile Content */}
            <div className="gc-col">
              <ReadinessCard
                balanceG={balanceG}
                dailyClaimG={123.48}
                onCashOutClick={() => setMobileView('cashout')}
                onAddClick={ADDG_ENABLED ? handleAddClick : undefined}
                feeNote={networkFee && !networkFee.enough ? `You also need about ${celoText(networkFee.needCelo)} CELO in your wallet to pay the network fee. G$ can't pay it, so top up a little CELO before cashing out.` : null}
                  language={language}
                isStale={balanceIsStale}
                ngnPerUsdt={liveNgnRate}
              />
              <div className="gc-sm" style={{ textAlign: 'center', marginTop: 4 }}>
                <a href="/about" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>About</a>
                {' · '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>Privacy</a>
                {' · '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>Terms</a>
              </div>
            </div>

            {/* Bottom Navigation */}
            <MobileBottomNav active={mobileView === 'home' ? 'home' : 'history'} onNavigate={(tab) => setMobileView(tab)} />
          </>
        )}
      </div>
    </div>
  );
}

export default App;