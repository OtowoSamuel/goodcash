import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useBankAccountVerification } from '../lib/useOffRamp';
import {
  createOnrampOrder,
  fetchOnrampQuote,
  fetchOnrampStatus,
  fetchSwapStatus,
  friendlyAddError,
  formatNaira,
  isAdultDate,
  readDollarsOnBase,
  returnToCelo,
  startGasFreeSwap,
  type OnrampOrder,
  type OnrampQuote,
  type OnrampStage,
} from '../lib/addGs';
import { reportIssue } from '../lib/diag';
import { BankPicker } from './BankPicker';

/**
 * Add G$: pay naira by bank transfer and get G$ in your wallet.
 * Steps: amount -> your details -> check and agree -> pay (the bank account to send to, always shown)
 *        -> waiting for your payment -> one tap to get your G$ -> done.
 * Customer wording only: no partner, token or network names.
 */

const SAVED_KEY = 'goodcash_addg_order';

interface Saved {
  order: OnrampOrder;
  wallet: string;
  swapRequestId?: string;
  /** The customer said they sent the transfer */
  sent?: boolean;
}

function loadSaved(wallet: string): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null') as Saved | null;
    return s && s.wallet.toLowerCase() === wallet.toLowerCase() ? s : null;
  } catch {
    return null;
  }
}
function save(s: Saved | null) {
  try {
    if (s) localStorage.setItem(SAVED_KEY, JSON.stringify(s));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    // private mode: the order simply will not resume after a reload
  }
}

type Step = 'amount' | 'details' | 'confirm' | 'pay' | 'waiting' | 'swap' | 'working' | 'done';

interface Props {
  wallet: string;
  onClose: () => void;
  /** Called when G$ has arrived, so the app can refresh the balance. */
  onArrived: () => void;
}

/** The server's own messages are already plain; anything else becomes a general line. */
function friendlyOrderError(e: unknown): string {
  const m = (e as Error)?.message ?? '';
  return m && m.length < 160 && !/[{}]|0x|Error|undefined/.test(m) ? m : 'We could not start this order. Please check your details and try again.';
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="gc-lab mb-1.5">{label}</div>
    {children}
  </div>
);
const STEPS = ['Amount', 'Details', 'Pay', 'Get G$'] as const;
function stepIndex(step: Step): number {
  if (step === 'amount') return 0;
  if (step === 'details' || step === 'confirm') return 1;
  if (step === 'pay' || step === 'waiting') return 2;
  return 3;
}
const Progress: React.FC<{ step: Step }> = ({ step }) => {
  const at = stepIndex(step);
  return (
    <div style={{ display: 'flex', gap: 6 }} aria-label={`Step ${at + 1} of ${STEPS.length}: ${STEPS[at]}`}>
      {STEPS.map((label, i) => (
        <div key={label} style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ height: 8, borderRadius: 99, border: '2px solid #111', background: i < at ? '#8cf0c0' : i === at ? '#7b39fc' : '#fff' }} />
          <div className="gc-sm" style={{ marginTop: 3, fontSize: 11, fontWeight: i === at ? 800 : 600 }}>{label}</div>
        </div>
      ))}
    </div>
  );
};

function timeLeft(validUntil: string, now: number): string | null {
  const ms = new Date(validUntil).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const INPUT = 'w-full rounded-xl border-[2.5px] border-[#111] bg-white px-4 py-3 text-base font-bold text-[#111] outline-none';

export const AddGsModal: React.FC<Props> = ({ wallet, onClose, onArrived }) => {
  const saved = useRef(loadSaved(wallet));
  const [step, setStep] = useState<Step>(
    saved.current ? (saved.current.swapRequestId ? 'working' : saved.current.sent ? 'waiting' : 'pay') : 'amount'
  );
  const [showBank, setShowBank] = useState(false);
  const [shareOk, setShareOk] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [order, setOrder] = useState<OnrampOrder | null>(saved.current?.order ?? null);
  const [naira, setNaira] = useState('');
  const [quote, setQuote] = useState<OnrampQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [idType, setIdType] = useState<'BVN' | 'NIN'>('BVN');
  const [idNumber, setIdNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<OnrampStage>('waiting');
  const [copied, setCopied] = useState<string | null>(null);
  const bank = useBankAccountVerification('NGN');

  const amount = Math.floor(Number(naira.replace(/,/g, '')) || 0);

  // Live price while typing
  useEffect(() => {
    if (step !== 'amount') return;
    setQuote(null);
    setQuoteError(null);
    if (amount < 1000) return;
    let live = true;
    const t = setTimeout(() => {
      fetchOnrampQuote(amount, wallet)
        .then((q) => live && setQuote(q))
        .catch((e: Error) => live && setQuoteError(e.message));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [amount, step, wallet]);

  // Follow the naira payment
  useEffect(() => {
    if ((step !== 'pay' && step !== 'waiting') || !order) return;
    let live = true;
    const tick = async () => {
      try {
        const s = await fetchOnrampStatus(order.orderId);
        if (!live) return;
        setStage(s.stage);
        if (s.stage === 'done') setStep('swap');
        else if ((s.stage === 'received' || s.stage === 'review') && step === 'pay') setStep('waiting');
      } catch {
        // keep trying
      }
    };
    void tick();
    const id = setInterval(tick, 8000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [step, order]);

  // Countdown on the pay screen
  useEffect(() => {
    if (step !== 'pay') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step]);

  // If we reopen with a swap already started, keep following it
  const follow = useCallback(async (requestId: string) => {
    for (let i = 0; i < 120; i++) {
      try {
        const s = await fetchSwapStatus(requestId);
        if (s === 'success') {
          save(null);
          await returnToCelo();
          setStep('done');
          onArrived();
          return;
        }
        if (s === 'failure' || s === 'refund') {
          setError('The swap did not go through. Your money is safe in your wallet. Please try again.');
          setStep('swap');
          return;
        }
      } catch {
        // keep trying
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    setError('This is taking longer than usual. Your money is safe. Please check back in a few minutes.');
    setStep('swap');
  }, [onArrived]);

  useEffect(() => {
    if (step === 'working' && saved.current?.swapRequestId) void follow(saved.current.swapRequestId);
    // only on first open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detailsOk =
    bank.verificationStatus === 'verified' &&
    !!bank.accountName &&
    bank.confirmed &&
    /^\d{11}$/.test(idNumber) &&
    isAdultDate(birthDate);
  const confirmOk = detailsOk && agree && shareOk;

  const submitDetails = async () => {
    if (!confirmOk || !bank.accountName) return;
    setBusy(true);
    setError(null);
    try {
      const o = await createOnrampOrder({
        naira: amount,
        wallet,
        fullName: bank.accountName,
        birthDate,
        idType,
        idNumber,
        refundAccount: { institution: bank.institutionCode, accountIdentifier: bank.accountIdentifier, accountName: bank.accountName },
      });
      setOrder(o);
      save({ order: o, wallet });
      setIdNumber('');
      setStage('waiting');
      setStep('pay');
    } catch (e) {
      setError(friendlyOrderError(e));
    } finally {
      setBusy(false);
    }
  };

  const getG = async () => {
    setBusy(true);
    setError(null);
    try {
      const have = await readDollarsOnBase(wallet);
      if (have < 500_000n) {
        setError(friendlyAddError(new Error('has not shown up')));
        return;
      }
      const r = await startGasFreeSwap(wallet, have);
      save({ order: order!, wallet, swapRequestId: r.requestId });
      saved.current = { order: order!, wallet, swapRequestId: r.requestId };
      setStep('working');
      void follow(r.requestId);
    } catch (e) {
      reportIssue('addgs_swap_failed', { message: String((e as Error)?.message ?? e).slice(0, 300) });
      setError(friendlyAddError(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const primary = (label: string, onClick: () => void, enabled: boolean) => (
    <button type="button" onClick={onClick} disabled={!enabled || busy} className={`gc-btn gc-hit ${enabled && !busy ? '' : 'gc-btn--dis'}`} style={{ height: 46, width: '100%' }}>
      {busy ? 'Please wait…' : label}
    </button>
  );
  const finish = () => {
    if (step === 'done') save(null);
    onClose();
  };

  let title = 'Add G$';
  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (step === 'amount') {
    body = (
      <>
        <Field label="How much naira do you want to add?">
          <input className={INPUT} inputMode="numeric" placeholder="₦5,000" value={naira} onChange={(e) => setNaira(e.target.value.replace(/[^\d,]/g, ''))} aria-label="Amount in naira" />
        </Field>
        {quote && (
          <div className="gc-note" style={{ background: '#8cf0c0' }}>
            <div className="gc-lab">You will get about</div>
            <b style={{ fontSize: 24 }}>{Math.floor(quote.gOutMin).toLocaleString('en-US')} G$</b>
            <div className="gc-sm">for {formatNaira(quote.naira)}. Fees are included.</div>
          </div>
        )}
        {quoteError && <div className="gc-note">{quoteError}</div>}
        <div className="gc-note">You pay by bank transfer, from your own bank account. Keep a little extra in that account, because your bank may charge its own transfer fee on top of the amount.</div>
        {quote && <div className="gc-sm">The smallest amount you can add is {formatNaira(quote.minNaira)}.</div>}
      </>
    );
    footer = primary('Continue', () => setStep('details'), !!quote);
  } else if (step === 'details') {
    title = 'Your details';
    body = (
      <>
        <div className="gc-note">By law, the payment partner must know who is paying. You will check everything on the next screen before anything is sent.</div>
        <Field label="Bank you will pay from">
          <BankPicker banks={bank.institutions} loading={bank.institutionsLoading} value={bank.institutionCode} onChange={bank.setInstitutionCode} label="Bank you will pay from" />
        </Field>
        <Field label="Account number">
          <input className={INPUT} inputMode="numeric" maxLength={10} value={bank.accountIdentifier} onChange={(e) => bank.setAccountIdentifier(e.target.value.replace(/\D/g, ''))} placeholder="10-digit account number" aria-label="Account number" />
        </Field>
        <div className="gc-note" style={{ background: bank.verificationStatus === 'verified' ? '#8cf0c0' : '#fff' }}>
          {bank.verificationStatus === 'loading' && 'Checking your account…'}
          {bank.verificationStatus === 'idle' && 'Choose your bank and enter your account number'}
          {bank.verificationStatus === 'error' && (bank.verificationError || 'Could not verify this account')}
          {bank.verificationStatus === 'verified' && bank.accountName && (
            <>
              <div className="gc-lab">Account name</div>
              <b>{bank.accountName}</b>
            </>
          )}
        </div>
        {bank.verificationStatus === 'verified' && (
          <label className="gc-sm" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={bank.confirmed} onChange={(e) => bank.setConfirmed(e.target.checked)} />
            This is my own account
          </label>
        )}
        <Field label="Date of birth">
          <input className={INPUT} type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} aria-label="Date of birth" />
        </Field>
        {birthDate && !isAdultDate(birthDate) && <div className="gc-sm" style={{ color: '#b00020' }}>You must be 18 or older.</div>}
        <Field label="ID number">
          <div className="flex gap-2 mb-2">
            {(['BVN', 'NIN'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setIdType(t)} className={`gc-pill gc-hit ${idType === t ? 'gc-pill--on' : ''}`}>{t}</button>
            ))}
          </div>
          <input className={INPUT} inputMode="numeric" maxLength={11} value={idNumber} onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, ''))} placeholder={`11-digit ${idType}`} aria-label="ID number" autoComplete="off" />
        </Field>
      </>
    );
    footer = (
      <>
        <button type="button" onClick={() => setStep('amount')} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, width: 'auto', flex: '1 1 0' }}>Back</button>
        <div style={{ flex: '2 1 0' }}>{primary('Continue', () => { setError(null); setStep('confirm'); }, detailsOk)}</div>
      </>
    );
  } else if (step === 'confirm') {
    title = 'Check and agree';
    const rows: Array<[string, string]> = [
      ['You pay', formatNaira(amount)],
      ['From', `${bank.selectedInstitution?.name?.trim() ?? 'your bank'} ••• ${bank.accountIdentifier.slice(-4)}`],
      ['Account name', bank.accountName ?? ''],
      ['You get about', quote ? `${Math.floor(quote.gOutMin).toLocaleString('en-US')} G$` : '—'],
      ['To your wallet', `${wallet.slice(0, 6)}…${wallet.slice(-4)}`],
      [idType, `••••••• ${idNumber.slice(-4)}`],
    ];
    body = (
      <>
        <div className="gc-card gc-cost" style={{ padding: '8px 14px' }}>
          {rows.map(([k, v]) => (
            <div key={k} className="gc-row">
              <span>{k}</span>
              <b style={{ textAlign: 'right' }}>{v}</b>
            </div>
          ))}
        </div>
        <label className="gc-sm" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={shareOk} onChange={(e) => setShareOk(e.target.checked)} style={{ marginTop: 3 }} />
          <span>I agree that my name, date of birth and {idType} are sent to GoodCash's payment partner to check who is paying, for this order only. GoodCash does not keep them.</span>
        </label>
        <label className="gc-sm" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
          <span>I will pay from the account above, with my own money. A payment from any other account is sent back.</span>
        </label>
        {error && <div className="gc-note" style={{ background: '#ffd6d6' }}>{error}</div>}
      </>
    );
    footer = (
      <>
        <button type="button" onClick={() => setStep('details')} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, width: 'auto', flex: '1 1 0' }}>Back</button>
        <div style={{ flex: '2 1 0' }}>{primary('Get bank details', () => void submitDetails(), confirmOk)}</div>
      </>
    );
  } else if ((step === 'pay' || step === 'waiting') && order && (stage === 'expired' || stage === 'refund')) {
    title = stage === 'expired' ? 'Time ran out' : 'Payment returned';
    body =
      stage === 'expired' ? (
        <div className="gc-note" style={{ background: '#ffd6d6' }}>This order ran out of time before your payment arrived. If you sent money, it will be returned to your account. You can start again.</div>
      ) : (
        <div className="gc-note" style={{ background: '#fff3c4' }}>Your payment is being returned to your account. This happens when it came from a different account than the one you gave, or a different amount was sent.</div>
      );
    footer = primary('Start again', () => { save(null); saved.current = null; setOrder(null); setStage('waiting'); setStep('amount'); }, true);
  } else if (step === 'pay' && order) {
    title = 'Send the money';
    const left = timeLeft(order.validUntil, now);
    const details: Array<[string, string]> = [
      ['Bank', order.bank.institution],
      ['Account number', order.bank.accountIdentifier],
      ['Account name', order.bank.accountName],
      ['Amount', String(Number(order.amountToTransfer))],
    ];
    body = (
      <>
        <div className="gc-note" style={{ background: '#fff3c4' }}>
          Open your bank app and send exactly <b>{formatNaira(Number(order.amountToTransfer))}</b> to this account, from <b>your own account</b>.
        </div>
        {details.map(([k, v]) => (
          <div key={k} className="gc-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
            <div style={{ minWidth: 0 }}>
              <div className="gc-lab">{k}</div>
              <b style={{ fontSize: k === 'Account number' || k === 'Amount' ? 22 : 16, overflowWrap: 'anywhere' }}>{k === 'Amount' ? formatNaira(Number(v)) : v}</b>
            </div>
            <button type="button" className="gc-pill gc-hit" onClick={() => copy(k, v)}>{copied === k ? 'Copied' : 'Copy'}</button>
          </div>
        ))}
        <div className="gc-sm">
          {left ? <>Pay within <b>{left}</b>. </> : null}
          A different amount, or a payment from someone else's account, is sent back.
        </div>
      </>
    );
    footer = primary("I've sent the money", () => { save({ order, wallet, sent: true }); saved.current = { order, wallet, sent: true }; setStep('waiting'); }, true);
  } else if (step === 'waiting' && order) {
    title = stage === 'received' ? 'Payment received' : stage === 'review' ? 'Checking your payment' : 'Waiting for your payment';
    body = (
      <>
        {stage === 'received' ? (
          <div className="gc-note" style={{ background: '#8cf0c0' }}>
            <b>We got your {formatNaira(Number(order.amountToTransfer))}.</b>
            <div className="gc-sm">Your money is on its way to your wallet. This usually takes a few minutes, then you tap once to get your G$.</div>
          </div>
        ) : stage === 'review' ? (
          <div className="gc-note" style={{ background: '#fff3c4' }}>
            <b>Your payment arrived and is being checked.</b>
            <div className="gc-sm">This can take longer than usual. You don't need to do anything, and please don't send it again.</div>
          </div>
        ) : (
          <div className="gc-note">
            <b>Waiting for your bank transfer.</b>
            <div className="gc-sm">This page updates by itself as soon as it arrives, usually within a few minutes. Please don't send it twice.</div>
          </div>
        )}
        {stage === 'waiting' && (
          <button type="button" className="gc-pill gc-hit" style={{ alignSelf: 'flex-start' }} onClick={() => setShowBank((v) => !v)}>
            {showBank ? 'Hide bank details' : 'Show bank details again'}
          </button>
        )}
        {stage === 'waiting' && showBank && (
          <div className="gc-card gc-cost" style={{ padding: '8px 14px' }}>
            <div className="gc-row"><span>Bank</span><b>{order.bank.institution}</b></div>
            <div className="gc-row"><span>Account number</span><b>{order.bank.accountIdentifier}</b></div>
            <div className="gc-row"><span>Account name</span><b>{order.bank.accountName}</b></div>
            <div className="gc-row"><span>Amount</span><b>{formatNaira(Number(order.amountToTransfer))}</b></div>
          </div>
        )}
      </>
    );
    footer = <button type="button" onClick={finish} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, width: '100%' }}>Close, we'll keep watching</button>;
  } else if (step === 'swap') {
    title = 'Your money is here';
    body = (
      <>
        <div className="gc-note" style={{ background: '#8cf0c0' }}>
          <b>Your naira payment is done.</b>
          <div className="gc-sm">One last step: tap below to turn it into G$. Your wallet may ask you to change network and sign one message. It costs you no fee.</div>
        </div>
        {error && <div className="gc-note" style={{ background: '#ffd6d6' }}>{error}</div>}
      </>
    );
    footer = primary('Get my G$', () => void getG(), true);
  } else if (step === 'working') {
    title = 'Getting your G$';
    body = <div className="gc-note">Almost there. This takes about a minute. You can keep this open.</div>;
    footer = <button type="button" onClick={finish} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, width: '100%' }}>Close (we keep watching)</button>;
  } else {
    title = 'All done';
    body = (
      <div className="gc-note" style={{ background: '#8cf0c0' }}>
        <b style={{ fontSize: 20 }}>Your G$ has arrived.</b>
        <div className="gc-sm">It is in your wallet now. You can cash out any time.</div>
      </div>
    );
    footer = primary('Done', finish, true);
  }

  return (
    <Modal label="Add G$" title={title} onClose={finish} z={80} tone="white" footer={footer}>
      <Progress step={step} />
      {body}
    </Modal>
  );
};

export default AddGsModal;
