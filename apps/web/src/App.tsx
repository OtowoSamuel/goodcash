import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { SafetyBanner } from './components/SafetyBanner';
import { ReadinessCard } from './components/ReadinessCard';
import { ClaimCard } from './components/ClaimCard';
import { CashOutCard } from './components/CashOutCard';
import { ConfirmModal } from './components/ConfirmModal';
import { CashOutTracker } from './components/CashOutTracker';
import { HistoryCard, type SwapHistoryItem } from './components/HistoryCard';
import type { Language } from './lib/i18n';
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
  // When swap succeeds but order creation fails, stash the result for retry
  const [pendingSwapResult, setPendingSwapResult] = useState<{
    txHash: string;
    usdtReceived: number;
    amountG?: number;
  } | null>(() => readPendingPayout());

  const [balanceG, setBalanceG] = useState<number>(() => {
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('goodcash_balance_g') : null;
    return cached ? parseFloat(cached) : 1297.5;
  });
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<number>(() => {
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('goodcash_balance_updated_at') : null;
    return cached ? Number(cached) : Date.now();
  });

  // History
  const [history, setHistory] = useState<SwapHistoryItem[]>(() => {
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('goodcash_history') : null;
    return cached ? JSON.parse(cached) : INITIAL_HISTORY;
  });

  // Modal & Success states
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

  // Sync active tracker to localStorage: store ONLY orderId and txHash (zero bank details)
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

  // Sync to localStorage
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

  // UBI Claim handler
  const handleClaimSuccess = (claimedG: number) => {
    setBalanceG((prev) => prev + claimedG);
    emitAnalyticsEvent('claim_confirmed', {
      wallet: walletAddress ?? '0x0000000000000000000000000000000000000000',
      amount: claimedG,
    });
  };

  // Initiate Cash Out review modal
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

  // Real router execution and Paycrest order creation
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
      // 1. Send router transaction, wait for receipt, parse CashOut event log
      const swapResult = await executeRouterSwap({
        amountG,
        quote,
        slippageBps,
        walletAddress: refundAddress,
        isDemoMode,
      });

      const realUsdtReceived = swapResult.usdtReceived;
      const realTxHash = swapResult.txHash;

      // Receipt confirmed: persist the payout handoff before calling Paycrest.
      // Only the swap identity is stored; bank details always stay in memory.
      savePendingPayout({ txHash: realTxHash, usdtReceived: realUsdtReceived });
      setPendingSwapResult({ txHash: realTxHash, usdtReceived: realUsdtReceived, amountG });

      // 2. Try to create Paycrest order using the REAL USDT amount from the log
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
        // Swap succeeded but order creation failed — keep the persisted record for retry
        setPendingSwapResult({ txHash: realTxHash, usdtReceived: realUsdtReceived, amountG });
        const orderMsg = orderErr instanceof Error ? orderErr.message : 'Order creation failed';
        setSwapError(`Swap confirmed (${realTxHash.slice(0, 10)}…) but payout order failed: ${orderMsg}`);
        return; // Do NOT re-throw — modal stays open with retry
      }

      // Order created: clear the pending-payout handoff
      clearPendingPayout();
      setPendingSwapResult(null);

      // 3. Update balances and history
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

      // 4. Open tracker screen with the created Paycrest order
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
      // Swap itself failed — strictly do NOT create Paycrest order, do NOT set trackerData
      throw err;
    }
  };

  // Retry payout: reuse the confirmed swap result without re-swapping
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

      // Success! Update balance, history, tracker
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

  // After a reload, the swap is already confirmed. The user re-enters bank
  // details here; they are used for this request only and never persisted.
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
      setCurrentTab('home');
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
          <MiniPayNotice />
        </div>
      </div>
    );
  }

  return (
    <div className="gc">
      {/* ── Top Navbar (Desktop bar-top + Mobile top row + Mobile bottom nav) ── */}
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

      {/* ── Main Responsive Content Area ── */}
      <main className="gc-main">
        {/* Mobile Safety Banner */}
        <div className="gc-mobile-only" style={{ width: '100%', maxWidth: '420px', margin: '0 auto' }}>
          <SafetyBanner language={language} />
        </div>

        {/* Primary Screen Column (Mobile full / Desktop 420px) */}
        <div className="gc-col">
          {trackerData ? (
            <CashOutTracker
              txHash={trackerData.txHash}
              usdtReceived={trackerData.usdtReceived}
              amountGSwapped={trackerData.amountGSwapped}
              bankName={trackerData.bankName || 'Bank Payout'}
              accountNumber={trackerData.accountNumber || '••••••••'}
              accountHolderName={trackerData.accountHolderName || 'Beneficiary'}
              ngnPerUsdt={trackerData.ngnPerUsdt}
              initialOrder={trackerData.initialOrder ?? (trackerData.orderId ? { orderId: trackerData.orderId } : undefined)}
              walletAddress={walletAddress ?? '0x0000000000000000000000000000000000000000'}
              language={language}
              onDone={() => {
                setTrackerData(null);
                setCurrentTab('home');
              }}
            />
          ) : pendingSwapResult && !pendingQuote ? (
            <PendingPayoutCard
              txHash={pendingSwapResult.txHash}
              usdtReceived={pendingSwapResult.usdtReceived}
              onRetry={handleFinishPendingPayout}
              errorMessage={swapError}
              language={language}
            />
          ) : currentTab === 'home' ? (
            <ReadinessCard
              balanceG={balanceG}
              dailyClaimG={123.48}
              onCashOutClick={() => setCurrentTab('cashout')}
              onClaimClick={() => setCurrentTab('claim')}
              language={language}
              isStale={balanceIsStale}
            />
          ) : currentTab === 'cashout' ? (
            <CashOutCard
              balanceG={balanceG}
              onInitiateCashOut={handleInitiateCashOut}
              language={language}
            />
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

        {/* Right Info Panel (Desktop only: 340px) */}
        <aside className="gc-side">
          {currentTab === 'home' && (
            <>
              <div className="gc-card">
                <div className="gc-lab">How it works</div>
                <div className="gc-st">
                  <b>1</b>
                  <span className="gc-sm">Swap your G$ to USDT on Celo.</span>
                </div>
                <div className="gc-st">
                  <b>2</b>
                  <span className="gc-sm">We send it to a licensed payout partner.</span>
                </div>
                <div className="gc-st">
                  <b>3</b>
                  <span className="gc-sm">Naira lands in your bank account.</span>
                </div>
              </div>
              <div className="gc-card">
                <div className="gc-lab">What it costs</div>
                <div className="gc-sm" style={{ marginTop: '4px' }}>
                  10% goes to the GoodDollar reserve. The network fee is under $0.001. You see every number before you confirm.
                </div>
              </div>
              <div className="gc-card gc-card--mint">
                <div className="gc-lab">Stay safe</div>
                <div className="gc-sm" style={{ marginTop: '4px' }}>
                  Never share your seed phrase. GoodCash will never message you first.{' '}
                  <a
                    href="https://celo.blockscout.com/address/0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407"
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
              <div className="gc-card gc-cost">
                <div className="gc-row">
                  <span className="gc-lab">What you’ll pay</span>
                  <span className="gc-pill gc-pill--mint">Refreshes in 18s</span>
                </div>
                <div className="gc-row">
                  <span>GoodDollar contribution (10%)</span>
                  <span className="gc-mark">−100 G$</span>
                </div>
                <div className="gc-row">
                  <span>Network fee</span>
                  <span>under $0.001</span>
                </div>
                <div className="gc-row">
                  <span>You get at least</span>
                  <span>0.1129 USDT</span>
                </div>
              </div>
              <div className="gc-card">
                <div className="gc-lab">Route</div>
                <div className="gc-sm" style={{ marginTop: '4px' }}>
                  GoodDollar reserve → Uniswap → payout partner.{' '}
                  <span style={{ textDecoration: 'underline', cursor: 'pointer' }}>Details</span>
                </div>
              </div>
              <div className="gc-card gc-card--yellow">
                <div className="gc-lab">Good to know</div>
                <div className="gc-sm" style={{ marginTop: '4px' }}>
                  Naira payouts need at least about $0.51 worth of G$. Arrival time depends on the payout partner.
                </div>
              </div>
            </>
          )}

          {currentTab === 'history' && (
            <>
              <div className="gc-card gc-cost">
                <div className="gc-lab" style={{ marginBottom: '2px' }}>Your totals</div>
                <div className="gc-row">
                  <span>Cash outs</span>
                  <span>{history.length}</span>
                </div>
                <div className="gc-row">
                  <span>G$ cashed out</span>
                  <span>
                    {history.reduce((sum, item) => sum + (item.amountInG || 0), 0).toLocaleString()} G$
                  </span>
                </div>
                <div className="gc-row">
                  <span>Naira received so far</span>
                  <span>
                    ₦
                    {history
                      .reduce((sum, item) => sum + (item.nairaAmount || 0), 0)
                      .toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="gc-card">
                <div className="gc-lab">What the statuses mean</div>
                <div className="gc-st">
                  <b>1</b>
                  <span className="gc-sm"><u>On its way</u>: swapped, waiting for the payout partner.</span>
                </div>
                <div className="gc-st">
                  <b>2</b>
                  <span className="gc-sm"><u>Paid</u>: naira sent to your bank account.</span>
                </div>
              </div>
              <div className="gc-card gc-card--mint">
                <div className="gc-lab">Receipts</div>
                <div className="gc-sm" style={{ marginTop: '4px' }}>
                  Every cash out has an on-chain receipt you can check on the Celo explorer.
                </div>
              </div>
            </>
          )}
        </aside>
      </main>

      {/* Confirmation Modal */}
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

      {/* ── Desktop Footer (900px and up) ── */}
      <footer className="gc-desktop-only gc-foot">
        <span>GoodCash © 2026 · Non-custodial Celo router</span>
        <div style={{ display: 'flex', gap: '16px' }}>
          <a
            href="https://celo.blockscout.com/address/0xA4338586d4B2f0E1641C54b8cF0d53CD06B5c407"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#111', textDecoration: 'none' }}
          >
            Contract
          </a>
          <a
            href="https://gooddollar.org"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#111', textDecoration: 'none' }}
          >
            GoodDollar
          </a>
          <a
            href="https://paycrest.io"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#111', textDecoration: 'none' }}
          >
            Paycrest
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;
