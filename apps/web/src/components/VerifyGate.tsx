import React, { useState } from 'react';
import { Modal } from './Modal';
import { type VerifiedStatus } from '../lib/verified';
import { startGoodDollarVerification, verifyStartError, type VerifyIntent } from '../lib/goodid';

interface Props {
  /** The wallet the customer is signed in with: the one GoodDollar verifies */
  wallet: string;
  /** What they were about to do, so they come straight back to it after verifying */
  intent: VerifyIntent;
  onClose: () => void;
  /** Runs when they turn out to be verified (the app carries on with what they were doing). Defaults to closing. */
  onVerified?: () => void;
  /** Asks again; resolves with the answer. */
  onRecheck: () => Promise<VerifiedStatus>;
  /** For tests: replaces the real start (sign, then go to GoodDollar) */
  start?: (wallet: string, intent: VerifyIntent) => Promise<void>;
}

/**
 * Shown instead of adding G$ or cashing out while the wallet is not verified with GoodDollar. The wallet they are
 * already signed in with signs GoodDollar's request here, on our site, so GoodDollar never asks them to log in again.
 */
export const VerifyGate: React.FC<Props> = ({ wallet, intent, onClose, onVerified, onRecheck, start = startGoodDollarVerification }) => {
  const [busy, setBusy] = useState<'signing' | 'checking' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stillNot, setStillNot] = useState(false);

  const verify = async () => {
    setBusy('signing');
    setProblem(null);
    setStillNot(false);
    try {
      await start(wallet, intent); // leaves the page for GoodDollar when it works
    } catch (e) {
      setProblem(verifyStartError(e));
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy('checking');
    setProblem(null);
    setStillNot(false);
    const s = await onRecheck();
    setBusy(null);
    if (s === 'verified') (onVerified ?? onClose)();
    else if (s === 'not_verified') setStillNot(true);
    else setProblem('We could not check right now. Please try again in a moment.');
  };

  return (
    <Modal
      label="Verify with GoodDollar"
      title="One quick step: verify"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 10, width: '100%', flexWrap: 'wrap' }}>
          <button type="button" onClick={verify} disabled={busy !== null} className="gc-btn gc-btn--yellow gc-hit" style={{ height: 46, flex: '1 1 160px' }}>
            {busy === 'signing' ? 'Check your wallet…' : 'Verify with GoodDollar'}
          </button>
          <button type="button" onClick={check} disabled={busy !== null} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, flex: '1 1 160px' }}>
            {busy === 'checking' ? 'Checking…' : "I've verified"}
          </button>
        </div>
      }
    >
      <p style={{ margin: '0 0 10px' }}>
        {intent === 'claim'
          ? 'Verifying with GoodDollar lets you claim free G$ here every day. It is quick and free.'
          : 'Verifying with GoodDollar is part of adding G$ and cashing out. It is quick, free, and only needs to be done once.'}
      </p>
      <p style={{ margin: 0 }}>
        Your wallet will ask you to approve a free message (no money is sent). Then GoodDollar opens for a short face check, and brings you back here to carry on.
      </p>
      {busy === 'signing' && (
        <p role="status" style={{ margin: '12px 0 0', fontWeight: 600 }}>
          Approve the message in your wallet to continue.
        </p>
      )}
      {stillNot && (
        <p role="status" style={{ margin: '12px 0 0', fontWeight: 600 }}>
          GoodDollar does not show this wallet as verified yet. It can take a minute after you finish. Please try again shortly.
        </p>
      )}
      {problem && (
        <p role="status" style={{ margin: '12px 0 0', fontWeight: 600 }}>
          {problem}
        </p>
      )}
    </Modal>
  );
};
