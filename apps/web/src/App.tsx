import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { SafetyBanner } from './components/SafetyBanner';
import { ReadinessCard } from './components/ReadinessCard';
import { ClaimCard } from './components/ClaimCard';
import { CashOutCard } from './components/CashOutCard';
import { MobileCashOut } from './components/MobileCashOut';
import { MobileReviewView } from './components/MobileReviewView';
import { MobileProcessingView } from './components/MobileProcessingView';
import { MobileSuccessView } from './components/MobileSuccessView';
import { ConfirmModal } from './components/ConfirmModal';
import { CashOutTracker } from './components/CashOutTracker';
import { HistoryCard, type SwapHistoryItem } from './components/HistoryCard';
import type { BankDetailsState } from './lib/useBankDetails';
import type { Language } from './lib/i18n';
import { getTranslations } from './lib/i18n';
import { getCashoutRate } from './lib/rate';
import { BLOCKSCOUT_URL } from './components/SafetyBanner';
import { getNetQuote, type QuoteResult } from './lib/quote';
import { decodeCashOutEvent, emitAnalyticsEvent } from './lib/analytics';
import { detectMiniPay } from './lib/mobile';
import { MiniPayNotice } from './components/MiniPayNotice';
import { executeRouterSwap, IS_DEMO_MODE } from './lib/router';
import { createPaycrestOrder, paycrestOrderAmount, type OffRampOrder } from './lib/useOffRamp';
import { PendingPayoutCard } from './components/PendingPayoutCard';

export const PENDING_PAYOUT_KEY = 'goodcash_pending_payout';

export interface PendingPayoutRecord {
  txHash: string;
  usdtReceived: number;
}

function readPendingPayout(): PendingPayoutRecord | null {
  if (typeof localStorage === 'undefined') return null;
  const saved = localStorage.getItem(PENDING_PAYOUT_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as Partial<PendingPayoutRecord>;
    if (typeof parsed?.txHash === 'string' && typeof parsed?.usdtReceived === 'number') {
      return { txHash: parsed.txHash, usdtReceived: parsed.usdtReceived };
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
  walletAddress: initialWalletAddress = '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
}: AppProps = {}) {
  const [currentTab, setCurrentTab] = useState<'home' | 'cashout' | 'claim' | 'history' | 'offramp'>('home');
  const [language, setLanguage] = useState<Language>('en');
  const [miniPayBlocked, setMiniPayBlocked] = useState<boolean>(() => detectMiniPay());
  const [walletAddress, setWalletAddress] = useState<string | null>(initialWalletAddress);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [pendingSwapResult, setPendingSwapResult] = useState<{
    txHash: string;
    usdtReceived: number;
    amountG?: number;
  } | null>(() => readPendingPayout());

  const [balanceG, setBalanceG] = useState<number>(() => {
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('goodcash_balance_g') : null;
    return cached ? parseFloat(cached) : IS_DEMO_MODE ? 50000 : 0;
  });
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<number>(() => {
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('goodcash_balance_updated_at') : null;
    return cached ? Number(cached) : Date.now();
  });
  const [activeCashOutAmount, setActiveCashOutAmount] = useState<string>('');
  const [savedBankDetails, setSavedBankDetails] = useState<BankDetailsState | null>(null);

  const [history, setHistory] = useState<SwapHistoryItem[]>(() => {
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('goodcash_history') : null;
    return cached ? JSON.parse(cached) : INITIAL_HISTORY;
  });

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
  } | null>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('goodcash_active_tracker');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') {
            return {
              txHash: parsed.txHash || '',
              orderId: parsed.orderId,
              usdtReceived: parsed.usdtReceived || 0,
              amountGSwapped: parsed.amountGSwapped || 0,
              ngnPerUsdt: parsed.ngnPerUsdt || null,
            };
          }
        } catch {}
      }
    }
    return null;
  });

  const [showPrivacy, setShowPrivacy] = useState(false);

  // Debug view toggle for mobile testing
  const [mobileView, setMobileView] = useState<
    'home' | 'cashout' | 'claim' | 'history' | 'offramp' | 'review' | 'processing' | 'success'
  >('home');

  const t = getTranslations(language);

  // Auto-navigate to cashout tab if there's a pending payout on mount
  useEffect(() => {
    if (pendingSwapResult && currentTab === 'home') {
      setCurrentTab('cashout');
    }
  }, [pendingSwapResult, currentTab]); // Auto-resume a pending payout

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      if (trackerData && (trackerData.orderId || trackerData.txHash)) {
        localStorage.setItem(
          'goodcash_active_tracker',
          JSON.stringify({
            orderId: trackerData.orderId,
            txHash: trackerData.txHash,
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

  const handleConnectWallet = () => {
    if (miniPayBlocked || detectMiniPay()) return;
    setWalletAddress('0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6');
    emitAnalyticsEvent('wallet_connected', {
      wallet: '0xafDeEbB89Cda1669361117eA2EAe3411F1228cb6',
      wallet_type: 'other',
      referral_tag: 'direct',
    });
  };

  const handleDisconnectWallet = () => {
    setWalletAddress(null);
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

  const handleClaimSuccess = (claimedG: number) => {
    setBalanceG((prev) => prev + claimedG);
    emitAnalyticsEvent('claim_confirmed', {
      wallet: walletAddress ?? '0x0000000000000000000000000000000000000000',
      amount: claimedG,
    });
  };

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

  const handleRefreshQuote = () => {
    if (!pendingQuote) return;
    setPendingQuote((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        quote: getNetQuote({ amountIn: BigInt(Math.floor(prev.amountG * 1e18)) }),
      };
    });
  };

  const handleConfirmSwap = async () => {
    if (!pendingQuote) return;
    if (!walletAddress) {
      setSwapError('Connect your wallet before cashing out.');
      return;
    }
    const refundAddress = walletAddress;
    const { amountG, quote, slippageBps } = pendingQuote;

    setSwapError(null);

    emitAnalyticsEvent('swap_submitted', {
      amount: amountG,
      slippage_setting: slippageBps / 100,
      route: quote.route,
    });

    try {
      const swapResult = await executeRouterSwap({
        amountG,
        quote,
        slippageBps,
        walletAddress: refundAddress,
        isDemoMode,
      });

      const realUsdtReceived = swapResult.usdtReceived;
      const realTxHash = swapResult.txHash;

      savePendingPayout({ txHash: realTxHash, usdtReceived: realUsdtReceived });
      setPendingSwapResult({ txHash: realTxHash, usdtReceived: realUsdtReceived, amountG });

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
        const orderMsg = orderErr instanceof Error ? orderErr.message : 'Order creation failed';
        setSwapError(`Swap confirmed (${realTxHash.slice(0, 10)}…) but payout order failed: ${orderMsg}`);
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
        steps: {
          swapped: 'completed',
          sentToPartner: 'pending',
          paidInNaira: 'pending',
        },
      };

      setHistory((prev) => [newHistoryItem, ...prev]);

      emitAnalyticsEvent(
        'CashOut',
        decodeCashOutEvent({
          user: walletAddress ?? '0x0000000000000000000000000000000000000000',
          recipient: '0x0000000000000000000000000000000000000000',
          tokenOut: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
          amountIn: BigInt(Math.floor(amountG * 1e18)),
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

      setPendingQuote(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Swap transaction failed';
      setSwapError(msg);
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
        steps: { swapped: 'completed', sentToPartner: 'pending', paidInNaira: 'pending' },
      };
      setHistory((prev) => [newHistoryItem, ...prev]);

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
      setPendingSwapResult(null);
      setPendingQuote(null);
    } catch (retryErr: unknown) {
      const msg = retryErr instanceof Error ? retryErr.message : 'Retry failed';
      setSwapError(`Retry payout failed: ${msg}`);
    }
  };

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
        steps: { swapped: 'completed', sentToPartner: 'pending', paidInNaira: 'pending' },
      };
      setHistory((prev) => [newHistoryItem, ...prev]);

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
      setPendingSwapResult(null);
      setPendingQuote(null);
      // Stay on cashout tab to show the tracker
      // setCurrentTab('home');
    } catch (retryErr: unknown) {
      const msg = retryErr instanceof Error ? retryErr.message : 'Retry failed';
      setSwapError(`Retry payout failed: ${msg}`);
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
        onSelectLanguage={setLanguage}
        isMiniPayBlocked={miniPayBlocked}
        isDemoMode={isDemoMode}
      />

      <main className="gc-main">
        <div className="gc-mobile-only" style={{ width: '100%', maxWidth: '420px', margin: '0 auto' }}>
          <SafetyBanner language={language} />
        </div>

        <div className="gc-col">
          {currentTab === 'home' ? (
            <ReadinessCard
              balanceG={balanceG}
              dailyClaimG={123.48}
              onCashOutClick={() => setCurrentTab('cashout')}
              onClaimClick={() => setCurrentTab('claim')}
              language={language}
              isStale={balanceIsStale}
            />
          ) : currentTab === 'cashout' ? (
            <>
              {trackerData ? (
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
                <CashOutCard
                  balanceG={balanceG}
                  onInitiateCashOut={handleInitiateCashOut}
                  language={language}
                  activeCashOutAmount={activeCashOutAmount}
                  setActiveCashOutAmount={setActiveCashOutAmount}
                  savedBankDetails={savedBankDetails}
                  setSavedBankDetails={setSavedBankDetails}
                />
              )}
            </>
          ) : currentTab === 'claim' ? (
            <ClaimCard
              isVerified={true}
              entitlementG={123.48}
              onClaimSuccess={handleClaimSuccess}
              language={language}
            />
          ) : currentTab === 'history' ? (
            <HistoryCard
              history={history}
              onCashOutClick={() => setCurrentTab('cashout')}
              language={language}
              ngnPerUsdt={pendingQuote?.ngnPerUsdt ?? null}
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
                    {pendingQuote?.quote
                      ? `0.${Math.floor((Number(pendingQuote.quote.usdtOut) / 1e6) * 10000).toString().padStart(4, '0')}`
                      : '—'}
                    USDT
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
                        const naira = item.nairaAmount ?? (pendingQuote?.ngnPerUsdt && pendingQuote.ngnPerUsdt > 0 ? getCashoutRate(item.amountInG, 123.48, pendingQuote.ngnPerUsdt).netNaira : 0);
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

      <button
        type="button"
        onClick={() => setShowPrivacy((v) => !v)}
        className="text-[#111] font-semibold text-sm underline hover:text-[#111]/80 mb-4 ml-4"
      >
        Privacy
      </button>

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
          onClose={() => { setPendingQuote(null); setPendingSwapResult(null); }}
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
        />
      )}

      <footer className="mt-auto flex justify-between items-center w-full bg-white border-t-4 border-[#111] px-6 py-4">
        <span className="font-semibold text-[#111]">{t.footerText}</span>
        <div className="flex items-center gap-4">
          <a
            href={BLOCKSCOUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#111] hover:text-[#111]/80 text-decoration-none font-semibold"
          >
            {t.contractLinkText}
          </a>
          <span className="text-[#111] font-semibold">·</span>
          <a
            href="https://gooddollar.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#111] hover:text-[#111]/80 text-decoration-none font-semibold"
          >
            {t.goodDollarLinkText}
          </a>
          <span className="text-[#111] font-semibold">·</span>
          <a
            href="https://paycrest.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#111] hover:text-[#111]/80 text-decoration-none font-semibold"
          >
            {t.paycrestLinkText}
          </a>
        </div>
      </footer>
      {/* ── End Desktop Layout ── */}
      </div>

      {/* ── Mobile Shell ── */}
      <div className="flex flex-col md:hidden w-full min-h-screen bg-[#d4c5fb] pb-24 relative">
        {/* Debug Panel - Only visible in development */}
        {isDemoMode && (
          <div className="fixed top-2 right-2 z-[100] bg-black/80 text-white p-2 rounded-lg text-xs">
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
            ngnPerUsdt={pendingQuote?.ngnPerUsdt ?? 1452.6}
            onClose={() => setMobileView('home')}
            onReview={(amountG: number, nairaEstimate: number | null, usdtEstimate: number) => {
              // Create quote and transition to the review view
              const quote = getNetQuote({ amountIn: BigInt(Math.floor(amountG * 1e18)) });
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
                ? (Number(pendingQuote.quote.usdtOut) / 1e6) * pendingQuote.ngnPerUsdt
                : null
            }
            usdtEstimate={pendingQuote?.quote ? Number(pendingQuote.quote.usdtOut) / 1e6 : null}
            onBack={() => setMobileView('cashout')}
            onConfirm={() => {
              handleConfirmSwap();
              setMobileView('processing');
            }}
            activeCashOutAmount={activeCashOutAmount}
            setActiveCashOutAmount={setActiveCashOutAmount}
            savedBankDetails={savedBankDetails}
            setSavedBankDetails={setSavedBankDetails}
          />
        ) : mobileView === 'processing' ? (
          <MobileProcessingView
            amountG={pendingQuote?.amountG ?? null}
            nairaEstimate={
              pendingQuote?.quote && pendingQuote.ngnPerUsdt
                ? (Number(pendingQuote.quote.usdtOut) / 1e6) * pendingQuote.ngnPerUsdt
                : null
            }
            usdtEstimate={pendingQuote?.quote ? Number(pendingQuote.quote.usdtOut) / 1e6 : null}
            txHash={trackerData?.txHash}
            onClose={() => setMobileView('home')}
            onBackToHome={() => setMobileView('home')}
          />
        ) : mobileView === 'success' ? (
          <MobileSuccessView
            nairaEstimate={
              pendingQuote?.quote && pendingQuote.ngnPerUsdt
                ? (Number(pendingQuote.quote.usdtOut) / 1e6) * pendingQuote.ngnPerUsdt
                : null
            }
            onClose={() => setMobileView('home')}
            onViewTransaction={() => setMobileView('processing')}
          />
        ) : (
          <>
            {/* Mobile Header */}
            <div className="flex justify-between items-center px-4 pt-6 pb-4">
              <div className="flex items-center gap-2">
                <span className="font-bold text-[#111] text-xl">GoodCash</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">EN ⌄</span>
                <button className="border-2 border-[#111] bg-white rounded-full px-3 py-1 font-bold text-sm">
                  {walletAddress ? walletAddress.slice(0, 6) + '…' + walletAddress.slice(-4) : 'Connect Wallet'}
                </button>
              </div>
            </div>

            {/* Mobile Content */}
            <div className="flex flex-col gap-4 px-4">
              <ReadinessCard
                balanceG={balanceG}
                dailyClaimG={123.48}
                onCashOutClick={() => setMobileView('cashout')}
                onClaimClick={() => setCurrentTab('claim')}
                language={language}
                isStale={balanceIsStale}
              />
            </div>

            {/* Bottom Navigation */}
            <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] bg-white border-2 border-[#111] rounded-full p-2 flex justify-between items-center shadow-[4px_4px_0px_#111] z-50 md:hidden">
              <button
                type="button"
                onClick={() => setMobileView('home')}
                className={
                  mobileView === 'home'
                    ? 'bg-[#7b39fc] text-white rounded-full px-6 py-2 font-bold'
                    : 'px-4 py-2 font-bold text-[#111]'
                }
              >
                Home
              </button>
              <button
                type="button"
                onClick={() => setMobileView('cashout')}
                className="px-4 py-2 font-bold text-[#111]"
              >
                Cash out
              </button>
              <button
                type="button"
                onClick={() => setCurrentTab('history')}
                className="px-4 py-2 font-bold text-[#111]"
              >
                History
              </button>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}

export default App;