import React, { useEffect, useId, useMemo, useState } from 'react';
import type { Bank, CashOut, CashOutStep, Signer } from '@goodcash/sdk';
import { useGoodCash } from './context';
import { useBanks, useCashOut, useCashOutStatus, useQuote, useVerifyAccount } from './hooks';
import { injectStyles } from './styles';
import { themeVars } from './theme';

export type CashOutEvent =
  | { type: 'cashout.created'; cashOut: CashOut }
  | { type: 'cashout.sent'; cashOut: CashOut }
  | { type: 'cashout.paid'; cashOut: CashOut }
  | { type: 'cashout.failed'; cashOut: CashOut }
  | { type: 'closed' };

export interface CashOutFlowProps {
  /** The customer's wallet. Defaults to the browser wallet (window.ethereum) when there is one. */
  signer?: Signer;
  /** The wallet address, when the signer cannot tell (send functions) */
  wallet?: `0x${string}`;
  defaultAmountG?: string | number;
  partnerRef?: string;
  onEvent?: (e: CashOutEvent) => void;
  /** Shows a close button when given */
  onClose?: () => void;
  /** Heading id for dialogs */
  titleId?: string;
}

const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-US')}`;
const gText = (n: number | string) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} G$`;

const WORKING: Record<CashOutStep, string> = {
  checking: 'Checking your wallet…',
  creating: 'Preparing your payout…',
  confirm_in_wallet: 'Confirm in your wallet. Open your wallet app, tap Confirm, then come back here.',
  confirming: 'Sending…',
  reporting: 'Sending…',
  done: 'Sent.',
};

type Stage = 'amount' | 'bank' | 'review' | 'working' | 'tracking';

function defaultSigner(): Signer | undefined {
  const eth = typeof window !== 'undefined' ? (window as unknown as { ethereum?: Signer }).ethereum : undefined;
  return eth ?? undefined;
}

export function CashOutFlow({ signer, wallet, defaultAmountG, partnerRef, onEvent, onClose, titleId }: CashOutFlowProps) {
  injectStyles();
  const { theme, client } = useGoodCash();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (theme.mode !== 'auto' || typeof window === 'undefined' || !window.matchMedia) return setDark(theme.mode === 'dark');
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setDark(mq.matches);
    const on = () => setDark(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [theme.mode]);
  const vars = useMemo(() => themeVars(theme, dark), [theme, dark]);

  const [stage, setStage] = useState<Stage>('amount');
  const [amount, setAmount] = useState(defaultAmountG === undefined ? '' : String(defaultAmountG));
  const [bank, setBank] = useState<Bank | null>(null);
  const [account, setAccount] = useState('');
  const [search, setSearch] = useState('');
  const { quote, error: quoteError, loading: quoting } = useQuote(amount);
  const { banks, error: banksError, loading: banksLoading } = useBanks();
  const { accountName, error: nameError, loading: naming } = useVerifyAccount(bank?.code ?? '', account);
  const run = useCashOut();
  const [trackId, setTrackId] = useState<string | null>(null);
  const status = useCashOutStatus(trackId);
  const ownTitle = useId();
  const amountId = useId();
  const acctId = useId();
  const searchId = useId();
  const ids = { title: titleId ?? ownTitle, amount: amountId, acct: acctId, search: searchId };

  const live = status.cashOut ?? run.cashOut;
  useEffect(() => {
    if (!status.cashOut) return;
    if (status.cashOut.status === 'paid') onEvent?.({ type: 'cashout.paid', cashOut: status.cashOut });
    if (['failed', 'refunded', 'expired'].includes(status.cashOut.status)) onEvent?.({ type: 'cashout.failed', cashOut: status.cashOut });
  }, [status.cashOut?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const shownBanks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return banks.filter((b) => !q || b.name.toLowerCase().includes(q));
  }, [banks, search]);

  const enough = !!quote && quote.enough;
  const stepIndex = { amount: 0, bank: 1, review: 2, working: 3, tracking: 3 }[stage];

  async function confirm() {
    if (!quote || !bank || !accountName) return;
    const s = signer ?? defaultSigner();
    setStage('working');
    const out = await run.start(
      { signer: s as Signer, wallet, amountG: amount, recipient: { bankCode: bank.code, accountNumber: account, accountName }, quote, partnerRef },
      (step, c) => {
        if (step === 'confirm_in_wallet' && c) onEvent?.({ type: 'cashout.created', cashOut: c });
      }
    );
    if (out) {
      onEvent?.({ type: 'cashout.sent', cashOut: out.cashOut });
      setTrackId(out.cashOut.id);
      setStage('tracking');
    } else {
      setStage('review');
    }
  }

  const noWallet = !signer && !defaultSigner() && client.mode === 'live';

  return (
    <div className="gcw" style={vars as React.CSSProperties} data-goodcash-flow="">
      <div className="gcw-top">
        <h2 className="gcw-h" id={ids.title}>
          Cash out to your bank
        </h2>
        {onClose && (
          <button type="button" className="gcw-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      <div className="gcw-steps" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`gcw-step ${i < stepIndex ? 'gcw-step--done' : i === stepIndex ? 'gcw-step--on' : ''}`} />
        ))}
      </div>
      {client.mode === 'test' && <p className="gcw-note">Test mode: no real money moves.</p>}

      {stage === 'amount' && (
        <>
          <div className="gcw-card">
            <label className="gcw-lab" htmlFor={ids.amount}>
              How much G$?
            </label>
            <input
              id={ids.amount}
              className="gcw-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </div>
          <div className="gcw-card gcw-card--ok" aria-live="polite">
            <span className="gcw-lab">You get about</span>
            <div className="gcw-big">{quote ? naira(quote.receive.naira) : quoting ? '…' : '₦0'}</div>
            {quote && <div className="gcw-row">at least {naira(quote.receive.minimumNaira)}</div>}
          </div>
          {quote && !quote.enough && <p className="gcw-note">The smallest cash out is about {gText(quote.minimumG)}.</p>}
          {quoteError && <p className="gcw-err">{quoteError.message}</p>}
          <button type="button" className="gcw-btn" disabled={!enough} onClick={() => setStage('bank')}>
            Next
          </button>
        </>
      )}

      {stage === 'bank' && (
        <>
          <div className="gcw-card">
            <label className="gcw-lab" htmlFor={ids.search}>
              Your bank
            </label>
            <input id={ids.search} className="gcw-input" type="search" placeholder="Search banks" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="gcw-banks" role="listbox" aria-label="Banks">
              {banksLoading && <span>Loading banks…</span>}
              {shownBanks.map((b) => (
                <button key={b.code} type="button" role="option" aria-selected={bank?.code === b.code} className="gcw-bank" onClick={() => setBank(b)}>
                  {b.name}
                  {bank?.code === b.code && <span aria-hidden> ✓</span>}
                </button>
              ))}
              {!banksLoading && shownBanks.length === 0 && <span>No bank matches “{search}”. Check the spelling.</span>}
            </div>
            {banksError && <p className="gcw-err">{banksError.message}</p>}
          </div>
          <div className="gcw-card">
            <label className="gcw-lab" htmlFor={ids.acct}>
              Account number
            </label>
            <input
              id={ids.acct}
              className="gcw-input"
              inputMode="numeric"
              autoComplete="off"
              maxLength={10}
              placeholder="10 digits"
              value={account}
              onChange={(e) => setAccount(e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
            <div aria-live="polite">
              {naming && <p className="gcw-sub">Checking the account name…</p>}
              {accountName && (
                <p className="gcw-sub">
                  <b>{accountName}</b>
                </p>
              )}
              {nameError && <p className="gcw-err">{nameError.message}</p>}
            </div>
          </div>
          <button type="button" className="gcw-btn" disabled={!accountName} onClick={() => setStage('review')}>
            Review
          </button>
          <button type="button" className="gcw-btn gcw-btn--ghost" onClick={() => setStage('amount')}>
            Back
          </button>
        </>
      )}

      {stage === 'review' && quote && bank && accountName && (
        <>
          <div className="gcw-card gcw-card--ok">
            <span className="gcw-lab">You get about</span>
            <div className="gcw-big">{naira(quote.receive.naira)}</div>
            <div className="gcw-row">
              for {gText(amount)} · at least {naira(quote.receive.minimumNaira)}
            </div>
          </div>
          <div className="gcw-card">
            <span className="gcw-lab">Paid to</span>
            <div>
              <b>{accountName}</b>
            </div>
            <div className="gcw-row">
              {bank.name} · ••••{account.slice(-4)}
            </div>
          </div>
          <div className="gcw-card">
            <span className="gcw-lab">Fees</span>
            {quote.fees.map((f) => (
              <div className="gcw-row" key={f.type}>
                <span>{f.label}</span>
                <span>{f.amountG ? `−${gText(f.amountG)}` : f.naira !== undefined ? naira(f.naira) : ''}</span>
              </div>
            ))}
            <div className="gcw-row">
              <span>Network fee</span>
              <span>paid in CELO from your wallet</span>
            </div>
          </div>
          {run.error && <p className="gcw-err">{run.error.message}</p>}
          {noWallet && <p className="gcw-err">Connect a wallet first.</p>}
          <p className="gcw-note">
            <b>You'll confirm once in your wallet.</b> Your G$ only leaves your wallet when you confirm.
          </p>
          <button type="button" className="gcw-btn" disabled={noWallet} onClick={confirm}>
            Confirm cash out
          </button>
          <button type="button" className="gcw-btn gcw-btn--ghost" onClick={() => setStage('bank')}>
            Back
          </button>
        </>
      )}

      {stage === 'working' && (
        <div className="gcw-card" aria-live="polite" role="status">
          <div className="gcw-spin" aria-hidden />
          <p className="gcw-sub" style={{ textAlign: 'center' }}>
            {run.step ? WORKING[run.step] : 'Working on it…'}
          </p>
        </div>
      )}

      {stage === 'tracking' && live && (
        <div aria-live="polite" role="status">
          {live.status === 'paid' ? (
            <div className="gcw-card gcw-card--ok">
              <span className="gcw-lab">Paid</span>
              <div className="gcw-big">{naira(live.receive.naira)}</div>
              <p className="gcw-sub">is in your bank account. Thank you!</p>
            </div>
          ) : ['failed', 'refunded', 'expired'].includes(live.status) ? (
            <div className="gcw-card">
              <span className="gcw-lab">Not paid</span>
              <p className="gcw-sub">
                {live.status === 'refunded'
                  ? 'The payout could not be completed, so your money is being returned to your wallet.'
                  : 'The payout could not be completed. Please contact support with your reference.'}
              </p>
              <div className="gcw-row">Reference: {live.id.slice(0, 8)}</div>
            </div>
          ) : (
            <div className="gcw-card">
              <div className="gcw-spin" aria-hidden />
              <p className="gcw-sub" style={{ textAlign: 'center' }}>
                Your money is on its way to your bank. This usually takes a few minutes. You can close this; it will still arrive.
              </p>
            </div>
          )}
          {onClose && (
            <button type="button" className="gcw-btn gcw-btn--ghost" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      )}

      <p className="gcw-foot">Powered by GoodCash</p>
    </div>
  );
}
