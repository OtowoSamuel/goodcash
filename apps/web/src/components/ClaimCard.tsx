import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { VerifiedStatus } from '../lib/verified';
import {
  askClaimGas,
  confirmClaim,
  friendlyClaimError,
  needsClaimGas,
  readClaim,
  sendClaim,
  timeUntil,
  waitForClaimGas,
  type ClaimInfo,
} from '../lib/claim';

type Step = 'idle' | 'gas' | 'wallet' | 'confirming';

export interface ClaimDeps {
  readClaim: typeof readClaim;
  needsClaimGas: typeof needsClaimGas;
  askClaimGas: typeof askClaimGas;
  waitForClaimGas: typeof waitForClaimGas;
  sendClaim: typeof sendClaim;
  confirmClaim: typeof confirmClaim;
}
const live: ClaimDeps = { readClaim, needsClaimGas, askClaimGas, waitForClaimGas, sendClaim, confirmClaim };

const fmt = (g: number) => g.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STEP_TEXT: Record<Exclude<Step, 'idle'>, string> = {
  gas: 'Getting the network fee for you…',
  wallet: 'Confirm the claim in your wallet',
  confirming: 'Claiming your G$…',
};

/**
 * "Your free G$ today": the daily GoodDollar claim, inside GoodCash.
 * Verified and ready: one tap to claim. Already claimed: when the next one opens. Not verified: one step to start.
 */
export const ClaimCard: React.FC<{
  wallet: string;
  verified: VerifiedStatus;
  onVerify: () => void;
  onClaimed?: (g: number) => void;
  onAddCelo?: () => void;
  deps?: ClaimDeps;
}> = ({ wallet, verified, onVerify, onClaimed, onAddCelo, deps = live }) => {
  const [info, setInfo] = useState<ClaimInfo | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [claimedG, setClaimedG] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [noGas, setNoGas] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await deps.readClaim(wallet);
      if (alive.current) setInfo(next);
    } catch {
      // The card waits quietly; the next refresh tries again
    }
  }, [wallet, deps]);

  useEffect(() => {
    alive.current = true;
    setInfo(null);
    setClaimedG(null);
    setProblem(null);
    if (verified === 'verified') void load();
    return () => {
      alive.current = false;
    };
  }, [verified, load]);

  // The countdown ticks; when the next claim opens, read again
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    if (info && info.readyG === 0 && info.nextAt > 0 && now >= info.nextAt && step === 'idle') void load();
  }, [now, info, step, load]);

  const claim = async () => {
    setProblem(null);
    setNoGas(false);
    try {
      if (await deps.needsClaimGas(wallet)) {
        setStep('gas');
        const answer = await deps.askClaimGas(wallet);
        if (answer === 'refused' || !(await deps.waitForClaimGas(wallet))) {
          setNoGas(true);
          throw new Error('NO_GAS');
        }
      }
      setStep('wallet');
      const hash = await deps.sendClaim(wallet);
      setStep('confirming');
      const got = await deps.confirmClaim(hash);
      const amount = got || info?.readyG || 0;
      if (!alive.current) return;
      setClaimedG(amount);
      setStep('idle');
      onClaimed?.(amount);
      void load();
    } catch (e) {
      if (!alive.current) return;
      setProblem(friendlyClaimError(e));
      setStep('idle');
    }
  };

  // One slim row in every state. Not verified yet: an offer, not a warning; Claim opens the one-time step (Home never
  // shows a verify banner).
  if (verified === 'not_verified') {
    return (
      <div className="gc-card gc-slim" data-testid="claim-card">
        <div className="gc-slim__text">
          <b>Free G$ every day</b> from GoodDollar
        </div>
        <button type="button" className="gc-slim__btn gc-hit" onClick={onVerify}>
          Claim
        </button>
      </div>
    );
  }
  if (verified !== 'verified' || !info) return null;

  // Claimed (just now, or earlier today): one quiet line
  if (claimedG !== null || info.readyG === 0) {
    const next = info.nextAt > 0 ? ` · next in ${timeUntil(info.nextAt, now)}` : '';
    return (
      <div className="gc-card gc-slim gc-slim--done" data-testid="claim-card" role={claimedG !== null ? 'status' : undefined}>
        <span className="gc-slim__tickwrap" aria-hidden="true"><svg className="gc-claim__tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        <div className="gc-slim__text">
          {claimedG !== null ? (
            <>
              <b>+{fmt(claimedG)} G$</b> claimed today{next}
            </>
          ) : (
            <>Claimed today{next}</>
          )}
        </div>
      </div>
    );
  }

  // Ready to claim
  const busy = step !== 'idle';
  return (
    <div className="gc-card gc-card--mint gc-slim" data-testid="claim-card">
      <div className="gc-slim__text" aria-live="polite">
        {busy ? (
          STEP_TEXT[step as Exclude<Step, 'idle'>]
        ) : problem ? (
          <>
            {problem}
            {noGas && onAddCelo && (
              <>
                {' '}
                <button type="button" className="gc-linkbtn" onClick={onAddCelo}>
                  Add a little CELO
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <b>+{fmt(info.readyG)} G$</b> free today
          </>
        )}
      </div>
      <button type="button" className="gc-slim__btn gc-slim__btn--go gc-hit" onClick={() => void claim()} disabled={busy} aria-busy={busy}>
        {busy ? <span className="gc-claim__spin" aria-label="Working" /> : 'Claim'}
      </button>
    </div>
  );
};
