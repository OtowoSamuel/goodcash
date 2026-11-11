import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GOODCASH_CSS, themeVars, type GoodCashTheme } from '@goodcash/react';
import { TEST_WALLET, type GoodCash, type TopUp, type TopUpAsset, type TopUpQuote } from '@goodcash/sdk';
import { createOrder, fetchInstitutions, fetchOrderLimit, findStuckOrder, formatNaira, isAdultDate, makeAppApi, relayStatus, reportArrived, verifyAccountName, type Institution, type OnrampOrder } from './api';
import { MIN_DOLLARS_ATOMIC, convertibleDollars, signAndStart, walletStepMessage, type Eip1193 } from './chain';

export type TopUpEventType = 'topup.created' | 'topup.paid_in' | 'topup.delivered' | 'topup.failed';

interface Props {
  client: GoodCash;
  theme: GoodCashTheme;
  /** The customer's wallet and its provider (live mode). Test mode needs neither. */
  wallet?: string;
  provider?: Eip1193;
  apiBase: string;
  defaultNaira?: string;
  defaultAsset?: TopUpAsset;
  partnerRef?: string;
  onEvent: (type: TopUpEventType, topUp: TopUp) => void;
  onClose: () => void;
}

type Stage = 'amount' | 'details' | 'pay' | 'collect' | 'working' | 'done' | 'failed';
const STEP_NAMES = ['Amount', 'Details', 'Pay', 'Get it'];
const stepOf = (s: Stage) => (s === 'amount' ? 0 : s === 'details' ? 1 : s === 'pay' ? 2 : 3);
const LABEL: Record<TopUpAsset, string> = { g: 'G$', celo: 'CELO' };

function ensureStyles() {
  if (typeof document === 'undefined' || document.querySelector('style[data-goodcash]')) return;
  const el = document.createElement('style');
  el.setAttribute('data-goodcash', '');
  el.textContent = GOODCASH_CSS;
  document.head.appendChild(el);
}

function amountText(n: number, asset: TopUpAsset): string {
  return asset === 'celo' ? `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CELO` : `${Math.floor(n).toLocaleString('en-US')} G$`;
}

/** Add G$ (or CELO) with naira: amount, details, pay by bank transfer, then one tap in the wallet. */
export function TopUpFlow({ client, theme, wallet, provider, apiBase, defaultNaira, defaultAsset, partnerRef, onEvent, onClose }: Props) {
  ensureStyles();
  const test = client.mode === 'test';
  const api = useMemo(() => makeAppApi(apiBase), [apiBase]);
  const who = test ? TEST_WALLET : wallet ?? '';

  const [stage, setStage] = useState<Stage>('amount');
  const [naira, setNaira] = useState(defaultNaira ?? '');
  const [asset, setAsset] = useState<TopUpAsset>(defaultAsset ?? 'g');
  const [quote, setQuote] = useState<TopUpQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [topUp, setTopUp] = useState<TopUp | null>(null);
  const [order, setOrder] = useState<OnrampOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // details (live): kept only in this page's memory, sent once to create the order, then cleared
  const [banks, setBanks] = useState<Institution[]>([]);
  const [search, setSearch] = useState('');
  const [bank, setBank] = useState<Institution | null>(null);
  const [acct, setAcct] = useState('');
  const [acctName, setAcctName] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [idType, setIdType] = useState<'BVN' | 'NIN'>('BVN');
  const [idNumber, setIdNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [agree, setAgree] = useState(false);
  const [now, setNow] = useState(Date.now());
  const seen = useRef<Set<string>>(new Set());
  const stageRef = useRef<Stage>('amount');
  stageRef.current = stage;
  const resumeChecked = useRef('');

  const amount = Math.floor(Number(naira.replace(/,/g, '')) || 0);
  const dark = theme.mode === 'dark' || (theme.mode === 'auto' && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const vars = themeVars(theme, dark) as React.CSSProperties;

  const emit = (type: TopUpEventType, t: TopUp) => {
    const once = `${t.id}:${type}`;
    if (seen.current.has(once)) return;
    seen.current.add(once);
    onEvent(type, t);
  };

  // A paid order whose last step never ran (they reloaded, or paid on another device): the money is waiting in their
  // wallet, so bring that step back. Checked once per wallet, from History (the same source the GoodCash app uses).
  useEffect(() => {
    if (test || !who || stage !== 'amount' || resumeChecked.current === who) return;
    resumeChecked.current = who;
    let live = true;
    findStuckOrder(api, who)
      .then((s) => {
        if (!live || !s || stageRef.current !== 'amount') return;
        setAsset(s.asset);
        setNaira(String(s.naira));
        setOrder({ orderId: s.orderId, status: 'settled', bank: { institution: '', accountIdentifier: '', accountName: '' }, amountToTransfer: String(s.naira), validUntil: '' });
        setStage('collect');
      })
      .catch(() => undefined); // History not reachable: the normal screen stays
    return () => {
      live = false;
    };
  }, [test, who, stage, api]);

  // The price, as the customer types
  useEffect(() => {
    if (stage !== 'amount') return;
    setQuote(null);
    setQuoteError(null);
    if (amount < 1000) return;
    let live = true;
    const t = setTimeout(() => {
      client
        .topUpQuote({ amountNaira: amount, asset, wallet: who || undefined })
        .then((q) => live && setQuote(q))
        .catch((e: Error) => live && setQuoteError(e.message));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [amount, asset, stage, client, who]);

  // Banks, when the details screen opens (live only)
  useEffect(() => {
    if (stage !== 'details' || banks.length) return;
    fetchInstitutions(api).then(setBanks).catch((e: Error) => setError(e.message));
  }, [stage, banks.length, api]);

  // The account name, once the bank and a 10-digit number are in
  useEffect(() => {
    setAcctName(null);
    if (!bank || !/^\d{10}$/.test(acct)) return;
    let live = true;
    setNaming(true);
    verifyAccountName(api, bank.code, acct)
      .then((n) => live && setAcctName(n))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setNaming(false));
    return () => {
      live = false;
    };
  }, [bank, acct, api]);

  // Follow the top-up from the moment it exists
  useEffect(() => {
    if (!topUp) return;
    const ctl = new AbortController();
    client
      .watchTopUp(
        topUp.id,
        (t) => {
          setTopUp(t);
          if (t.status === 'paid_in') {
            emit('topup.paid_in', t);
            setStage((s) => (s === 'pay' ? (test ? 'working' : 'collect') : s));
          }
          if (t.status === 'delivered') {
            emit('topup.paid_in', t);
            emit('topup.delivered', t);
            setStage('done');
          }
          if (t.status === 'failed' || t.status === 'expired') {
            emit('topup.failed', t);
            setStage('failed');
          }
        },
        { signal: ctl.signal, minIntervalMs: 2500, maxIntervalMs: 12000 }
      )
      .catch(() => undefined);
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topUp?.id]);

  // Countdown on the pay screen
  useEffect(() => {
    if (stage !== 'pay' || test) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stage, test]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      if (test) {
        const t = await client.createTopUp({ wallet: TEST_WALLET, amountNaira: amount, asset, partnerRef });
        setTopUp(t);
        emit('topup.created', t);
        setStage('pay');
      } else {
        setStage('details');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitDetails = async () => {
    if (!bank || !acctName) return;
    setBusy(true);
    setError(null);
    try {
      const o = await createOrder(api, {
        naira: amount,
        wallet: who,
        asset,
        fullName: acctName,
        birthDate,
        idType,
        idNumber,
        expectedOut: quote?.youGet.minimum,
        refundAccount: { institution: bank.code, accountIdentifier: acct, accountName: acctName },
      });
      // Only the order id goes to the partner API (never the ID details)
      const t = await client.createTopUp({ wallet: who, amountNaira: amount, asset, partnerRef, orderId: o.orderId });
      setIdNumber('');
      setBirthDate('');
      setOrder(o);
      setTopUp(t);
      emit('topup.created', t);
      setStage('pay');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const collect = async () => {
    if (!provider || !order) return;
    setBusy(true);
    setError(null);
    try {
      const have = await convertibleDollars(who, () => fetchOrderLimit(api, order.orderId));
      if (have < MIN_DOLLARS_ATOMIC) throw new Error('Your money has not shown up in your wallet yet. Please wait a minute and try again.');
      const { requestId } = await signAndStart(provider, who, have, asset, api.post, order.orderId);
      setStage('working');
      for (let i = 0; i < 120; i++) {
        const st = await relayStatus(api, requestId).catch(() => 'pending');
        if (st === 'success') {
          void reportArrived(api, order.orderId, requestId).catch(() => undefined);
          // A finished earlier order has no top-up to follow, so nothing else will move the screen on
          if (!topUp) setStage('done');
          break;
        }
        if (st === 'failure' || st === 'refund') throw new Error('That did not go through. Your money is safe in your wallet. Please try again.');
        await new Promise((r) => setTimeout(r, 4000));
      }
    } catch (e) {
      setStage('collect');
      const msg = (e as Error).message;
      setError(/has not shown up|did not go through/.test(msg) ? msg : walletStepMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const detailsOk = !!bank && !!acctName && /^\d{11}$/.test(idNumber) && isAdultDate(birthDate) && agree;
  const what = LABEL[asset];
  const shownBanks = banks.filter((b) => b.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 40);
  const left = order ? Math.max(0, Math.floor((new Date(order.validUntil).getTime() - now) / 1000)) : 0;

  return (
    <div className="gcw" style={vars} data-goodcash-topup="">
      <div className="gcw-top">
        <h2 className="gcw-h">
          {stage === 'done' ? 'All done' : stage === 'failed' ? 'This did not finish' : stage === 'collect' ? `Get your ${what}` : stage === 'working' ? `Getting your ${what}` : `Add ${what}`}
        </h2>
        <button type="button" className="gcw-x" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      {stage !== 'done' && stage !== 'failed' && (
        <>
          <div className="gcw-steps" aria-hidden>
            {STEP_NAMES.map((n, i) => (
              <span key={n} className={`gcw-step ${i < stepOf(stage) ? 'gcw-step--done' : ''} ${i === stepOf(stage) ? 'gcw-step--on' : ''}`} />
            ))}
          </div>
          <p className="gcw-sub" style={{ fontWeight: 700 }}>
            Step {stepOf(stage) + 1} of {STEP_NAMES.length}: {STEP_NAMES[stepOf(stage)]}
          </p>
        </>
      )}
      {test && <p className="gcw-note">Test mode: no real money moves.</p>}

      {stage === 'amount' && (
        <>
          <div className="gcw-card">
            <span className="gcw-lab">What do you want to add?</span>
            <div className="gcw-row" role="group" aria-label="What do you want to add?">
              {(['g', 'celo'] as const).map((a) => (
                <button key={a} type="button" aria-pressed={asset === a} className={`gcw-btn ${asset === a ? '' : 'gcw-btn--ghost'}`} onClick={() => setAsset(a)}>
                  {LABEL[a]}
                </button>
              ))}
            </div>
          </div>
          <div className="gcw-card">
            <label className="gcw-lab" htmlFor="gcw-naira">
              How much naira do you want to add?
            </label>
            <input id="gcw-naira" className="gcw-input" inputMode="numeric" placeholder="₦5,000" value={naira} onChange={(e) => setNaira(e.target.value.replace(/[^\d,]/g, ''))} />
          </div>
          {amount >= 1000 && !quote && !quoteError && (
            <div className="gcw-card gcw-card--ok" role="status" aria-live="polite">
              <span className="gcw-lab">You will get about</span>
              <div className="gcw-row">
                <span className="gcw-spin" aria-hidden />
                <b>Working out your {what}…</b>
              </div>
            </div>
          )}
          {quote && (
            <div className="gcw-card gcw-card--ok" aria-live="polite">
              <span className="gcw-lab">You will get about</span>
              <div className="gcw-big">{amountText(quote.youGet.amount, asset)}</div>
              <div className="gcw-sub">for {formatNaira(quote.amountNaira)}. At least {amountText(quote.youGet.minimum, asset)}.</div>
              {quote.fees.map((f) => (
                <div className="gcw-row" key={f.label}>
                  <span>{f.label}</span>
                  <span>${f.usd.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
          {quoteError && <p className="gcw-err">{quoteError}</p>}
          {error && <p className="gcw-err">{error}</p>}
          <button type="button" className="gcw-btn" disabled={!quote || busy || (!test && !who)} onClick={start}>
            {busy ? 'Please wait…' : 'Continue'}
          </button>
        </>
      )}

      {stage === 'details' && (
        <>
          <p className="gcw-note">By law, the payment partner must know who is paying. These details go straight to them from this page. We never keep them, and the app you came from never sees them.</p>
          <div className="gcw-card">
            <label className="gcw-lab" htmlFor="gcw-search">
              Bank you will pay from
            </label>
            <input id="gcw-search" className="gcw-input" type="search" placeholder="Search banks" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="gcw-banks" role="listbox" aria-label="Banks">
              {shownBanks.map((b) => (
                <button key={b.code} type="button" role="option" aria-selected={bank?.code === b.code} className="gcw-bank" onClick={() => setBank(b)}>
                  {b.name}
                </button>
              ))}
            </div>
          </div>
          <div className="gcw-card">
            <label className="gcw-lab" htmlFor="gcw-acct">
              Account number
            </label>
            <input id="gcw-acct" className="gcw-input" inputMode="numeric" maxLength={10} value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, ''))} placeholder="10-digit account number" />
            {naming && <p className="gcw-sub">Checking the account name…</p>}
            {acctName && <p className="gcw-sub">Account name: <b>{acctName}</b></p>}
          </div>
          <div className="gcw-card">
            <label className="gcw-lab" htmlFor="gcw-id">
              Your {idType}
            </label>
            <div className="gcw-row">
              {(['BVN', 'NIN'] as const).map((t) => (
                <button key={t} type="button" aria-pressed={idType === t} className={`gcw-btn ${idType === t ? '' : 'gcw-btn--ghost'}`} onClick={() => setIdType(t)}>
                  {t}
                </button>
              ))}
            </div>
            <input id="gcw-id" className="gcw-input" inputMode="numeric" autoComplete="off" maxLength={11} value={idNumber} onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, ''))} placeholder="11 digits" />
            <label className="gcw-lab" htmlFor="gcw-dob">
              Date of birth
            </label>
            <input id="gcw-dob" className="gcw-input" type="date" autoComplete="off" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            {birthDate && !isAdultDate(birthDate) && <p className="gcw-err">You must be 18 or older to use this.</p>}
          </div>
          <label className="gcw-sub">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> The name on my {idType} matches the bank account I will pay from, and I will pay from that account only.
          </label>
          {error && <p className="gcw-err">{error}</p>}
          <button type="button" className="gcw-btn" disabled={!detailsOk || busy} onClick={submitDetails}>
            {busy ? 'Please wait…' : 'Get payment details'}
          </button>
          <button type="button" className="gcw-btn gcw-btn--ghost" onClick={() => { setStage('amount'); setError(null); }}>
            Back
          </button>
        </>
      )}

      {stage === 'pay' && (
        <>
          {test ? (
            <div className="gcw-card" role="status" aria-live="polite">
              <b>Test mode: pretending you paid.</b>
              <p className="gcw-sub">In a few seconds this moves on by itself, so you can see every step. An amount ending in 13 shows the failure screen.</p>
            </div>
          ) : (
            order && (
              <>
                <div className="gcw-card gcw-card--ok">
                  <span className="gcw-lab">Pay exactly</span>
                  <div className="gcw-big">{formatNaira(Number(order.amountToTransfer))}</div>
                  <div className="gcw-sub">by bank transfer, from your own bank account. {left > 0 ? `Time left: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.` : 'This payment window has closed.'}</div>
                </div>
                <div className="gcw-card">
                  <div className="gcw-row"><span>Bank</span><b>{order.bank.institution}</b></div>
                  <div className="gcw-row"><span>Account number</span><b>{order.bank.accountIdentifier}</b></div>
                  <div className="gcw-row"><span>Account name</span><b>{order.bank.accountName}</b></div>
                </div>
              </>
            )
          )}
          <div className="gcw-card" role="status" aria-live="polite">
            <div className="gcw-row">
              <span className="gcw-spin" aria-hidden />
              <b>Waiting for your payment</b>
            </div>
            <p className="gcw-sub">Please keep this page open. It moves on by itself when your money arrives.</p>
          </div>
        </>
      )}

      {stage === 'collect' && (
        <>
          <div className="gcw-card gcw-card--ok">
            <b>Your {order ? formatNaira(Number(order.amountToTransfer)) : 'money'} has arrived!</b>
            <p className="gcw-sub">It is waiting for you. Tap "Get my {what}" to receive it in your wallet. Your {what} is only added after you tap.</p>
          </div>
          <p className="gcw-note">Your wallet will ask you to approve once. It costs you nothing. Please keep this page open until it is done.</p>
          {error && <p className="gcw-err">{error}</p>}
          <button type="button" className="gcw-btn" disabled={busy} onClick={collect}>
            {busy ? 'Please wait…' : `Get my ${what}`}
          </button>
        </>
      )}

      {stage === 'working' && (
        <div className="gcw-card gcw-card--ok" role="status" aria-live="polite">
          <div className="gcw-row">
            <span className="gcw-spin" aria-hidden />
            <b>{order ? `Turning your ${formatNaira(Number(order.amountToTransfer))} into ${what}…` : `Turning your money into ${what}…`}</b>
          </div>
          <p className="gcw-sub">Almost there. It takes about a minute. Please keep this page open.</p>
        </div>
      )}

      {stage === 'done' && (
        <>
          <div className="gcw-card gcw-card--ok" role="status">
            <b className="gcw-big">Your {what} has arrived.</b>
            <p className="gcw-sub">It is in your wallet now.</p>
          </div>
          <button type="button" className="gcw-btn" onClick={onClose}>
            Done
          </button>
        </>
      )}

      {stage === 'failed' && (
        <>
          <div className="gcw-card" role="alert">
            <b>{topUp?.status === 'expired' ? 'The payment window closed.' : 'This top-up did not finish.'}</b>
            <p className="gcw-sub">If you sent a bank transfer, it is refunded to your bank account. Nothing was added to your wallet.</p>
          </div>
          <button type="button" className="gcw-btn" onClick={onClose}>
            Close
          </button>
        </>
      )}
      <p className="gcw-foot">Powered by GoodCash</p>
    </div>
  );
}
