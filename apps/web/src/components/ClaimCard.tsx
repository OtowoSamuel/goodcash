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

  // Not verified yet: an offer, not a warning. Starting it opens the one-time step (Home never shows a verify banner)
  if (verified === 'not_verified') {
    return (
      <div className="gc-card gc-card--dashed gc-claim" data-testid="claim-card">
        <div className="gc-claim__text">
          <div className="gc-lab">Free G$ every day</div>
          <div className="gc-sm" style={{ marginTop: 2 }}>
            GoodDollar gives free G$ to every person, every day. Claim yours right here.
          </div>
        </div>
        <button type="button" className="gc-btn gc-btn--yellow gc-hit gc-claim__btn" onClick={onVerify}>
          Start
        </button>
      </div>
    );
  }
  if (verified !== 'verified' || !info) return null;

  // Just claimed
  if (claimedG !== null) {
    return (
      <div className="gc-card gc-card--mint gc-claim" data-testid="claim-card" role="status">
        <div className="gc-claim__text">
          <div className="gc-lab">Claimed today</div>
          <div className="gc-claim__amount">+{fmt(claimedG)} G$</div>
          <div className="gc-sm">
            {info.nextAt > 0 ? `Next free G$ in ${timeUntil(info.nextAt, now)}.` : 'It is in your balance now.'}
          </div>
        </div>
        <div className="gc-claim__done" aria-hidden="true">✓</div>
        <div className="gc-sticker">Nice one</div>
      </div>
    );
  }

  // Already claimed today
  if (info.readyG === 0) {
    return (
      <div className="gc-card gc-claim" data-testid="claim-card">
        <div className="gc-claim__text">
          <div className="gc-lab">Free G$</div>
          <div className="gc-sm" style={{ marginTop: 2 }}>
            Today's is claimed. Next one in <b>{timeUntil(info.nextAt, now)}</b>.
          </div>
        </div>
        <div className="gc-claim__done gc-claim__done--muted" aria-hidden="true">✓</div>
      </div>
    );
  }

  // Ready to claim
  const busy = step !== 'idle';
  return (
    <div className="gc-card gc-card--mint gc-claim" data-testid="claim-card">
      <div className="gc-claim__text">
        <div className="gc-lab">Your free G$ today</div>
        <div className="gc-claim__amount">+{fmt(info.readyG)} G$</div>
        <div className="gc-sm" aria-live="polite">
          {busy ? STEP_TEXT[step as Exclude<Step, 'idle'>] : problem ?? 'From GoodDollar. Claim it once a day.'}
        </div>
        {noGas && onAddCelo && !busy && (
          <button type="button" className="gc-claim__link" onClick={onAddCelo}>
            Add a little CELO
          </button>
        )}
      </div>
      <button type="button" className="gc-btn gc-hit gc-claim__btn" onClick={() => void claim()} disabled={busy} aria-busy={busy}>
        {busy ? <span className="gc-claim__spin" aria-label="Working" /> : 'Claim'}
      </button>
      {!busy && !problem && <div className="gc-sticker">Daily</div>}
    </div>
  );
};
