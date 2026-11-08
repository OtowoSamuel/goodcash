import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useBankAccountVerification } from '../lib/useOffRamp';
import {
  createOnrampOrder,
  fetchOnrampQuote,
  fetchOnrampStatus,
  fetchSwapStatus,
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

/**
 * Add G$: pay naira by bank transfer and get G$ in your wallet.
 * Steps: amount -> your details -> pay -> (we wait) -> one tap to get your G$ -> done.
 * Customer wording only: no partner, token or network names.
 */

const SAVED_KEY = 'goodcash_addg_order';
const SELECT_BG = 'bg-no-repeat bg-[right_1rem_center]';

interface Saved {
  order: OnrampOrder;
  wallet: string;
  swapRequestId?: string;
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

type Step = 'amount' | 'details' | 'pay' | 'swap' | 'working' | 'done' | 'problem';

interface Props {
  wallet: string;
  onClose: () => void;
  /** Called when G$ has arrived, so the app can refresh the balance. */
  onArrived: () => void;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="gc-lab mb-1.5">{label}</div>
    {children}
  </div>
);
const INPUT = 'w-full rounded-xl border-[2.5px] border-[#111] bg-white px-4 py-3 text-base font-bold text-[#111] outline-none';

export const AddGsModal: React.FC<Props> = ({ wallet, onClose, onArrived }) => {
  const saved = useRef(loadSaved(wallet));
  const [step, setStep] = useState<Step>(saved.current ? (saved.current.swapRequestId ? 'working' : 'pay') : 'amount');
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
    if (step !== 'pay' || !order) return;
    let live = true;
    const tick = async () => {
      try {
        const s = await fetchOnrampStatus(order.orderId);
        if (!live) return;
        setStage(s.stage);
        if (s.stage === 'done') setStep('swap');
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
    isAdultDate(birthDate) &&
    agree;

  const submitDetails = async () => {
    if (!detailsOk || !bank.accountName) return;
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
      setStep('pay');
    } catch (e) {
      setError((e as Error).message);
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
        setError('Your money has not shown up in your wallet yet. Please wait a minute and try again.');
        return;
      }
      const r = await startGasFreeSwap(wallet, have);
      save({ order: order!, wallet, swapRequestId: r.requestId });
      saved.current = { order: order!, wallet, swapRequestId: r.requestId };
      setStep('working');
      void follow(r.requestId);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/reject|denied|cancel/i.test(msg)) setError('You cancelled in your wallet. Nothing was taken. Tap to try again.');
      else {
        reportIssue('addgs_swap_failed', { message: msg.slice(0, 200) });
        setError(msg.length < 140 ? msg : 'Something went wrong. Nothing was taken. Please try again.');
      }
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
        <div className="gc-note">You pay by bank transfer, from your own bank account. It takes a few minutes.</div>
      </>
    );
    footer = primary('Continue', () => setStep('details'), !!quote);
  } else if (step === 'details') {
    title = 'Your details';
    body = (
      <>
        <div className="gc-note">By law we need to know who is paying. Your details are sent once to complete this order and are not kept by GoodCash.</div>
        <Field label="Bank you will pay from">
          <select value={bank.institutionCode} onChange={(e) => bank.setInstitutionCode(e.target.value)} disabled={bank.institutionsLoading} className={`${INPUT} appearance-none ${SELECT_BG}`} aria-label="Bank">
            <option value="">{bank.institutionsLoading ? 'Loading banks…' : 'Select bank'}</option>
            {bank.institutions.map((b) => (
              <option key={b.code} value={b.code}>{b.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Account number">
          <input className={INPUT} inputMode="numeric" maxLength={10} value={bank.accountIdentifier} onChange={(e) => bank.setAccountIdentifier(e.target.value.replace(/\D/g, ''))} placeholder="10-digit account number" aria-label="Account number" />
        </Field>
        <div className="gc-note" style={{ background: bank.verificationStatus === 'verified' ? '#8cf0c0' : '#fff' }}>
          {bank.verificationStatus === 'loading' && 'Checking your account…'}
          {bank.verificationStatus === 'idle' && 'Enter your bank and account number'}
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
        <label className="gc-sm" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          I will pay from this account, with my own money
        </label>
        {error && <div className="gc-note" style={{ background: '#ffd6d6' }}>{error}</div>}
      </>
    );
    footer = (
      <>
        <button type="button" onClick={() => setStep('amount')} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, width: 'auto', flex: '1 1 0' }}>Back</button>
        <div style={{ flex: '2 1 0' }}>{primary('Get bank details', () => void submitDetails(), detailsOk)}</div>
      </>
    );
  } else if (step === 'pay' && order) {
    title = 'Send the money';
    const expired = stage === 'expired';
    body = (
      <>
        {stage === 'received' || stage === 'review' ? (
          <div className="gc-note" style={{ background: '#8cf0c0' }}>
            <b>{stage === 'review' ? 'We are checking your payment.' : 'We got your payment!'}</b>
            <div className="gc-sm">{stage === 'review' ? 'This can take a little longer. You do not need to do anything.' : 'Your money is on its way. This takes a few minutes.'}</div>
          </div>
        ) : expired ? (
          <div className="gc-note" style={{ background: '#ffd6d6' }}>This order ran out of time. If you sent money, it will be returned to your account. You can start again.</div>
        ) : stage === 'refund' ? (
          <div className="gc-note" style={{ background: '#fff3c4' }}>Your payment is being returned to your account. This happens when the payment was not from the account you gave us.</div>
        ) : (
          <>
            <div className="gc-note" style={{ background: '#fff3c4' }}>
              Send exactly <b>{formatNaira(Number(order.amountToTransfer))}</b> from <b>your own account</b>. A different amount or a different account will be returned.
            </div>
            {([
              ['Bank', order.bank.institution],
              ['Account number', order.bank.accountIdentifier],
              ['Account name', order.bank.accountName],
              ['Amount', String(Number(order.amountToTransfer))],
            ] as const).map(([k, v]) => (
              <div key={k} className="gc-note" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div className="gc-lab">{k}</div>
                  <b>{v}</b>
                </div>
                <button type="button" className="gc-pill gc-hit" onClick={() => copy(k, v)}>{copied === k ? 'Copied' : 'Copy'}</button>
              </div>
            ))}
            <div className="gc-sm">Pay before {new Date(order.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. This page updates by itself once we see your money.</div>
          </>
        )}
      </>
    );
    footer = expired || stage === 'refund' ? primary('Start again', () => { save(null); saved.current = null; setOrder(null); setStage('waiting'); setStep('amount'); }, true) : (
      <button type="button" onClick={finish} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, width: '100%' }}>Close (we keep watching)</button>
    );
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
      {body}
    </Modal>
  );
};

export default AddGsModal;
