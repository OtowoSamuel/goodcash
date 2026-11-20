import React, { useState } from 'react';
import { Modal } from './Modal';
import { GOODDOLLAR_VERIFY_URL, type VerifiedStatus } from '../lib/verified';

interface Props {
  onClose: () => void;
  /** Runs when they turn out to be verified (the app carries on with what they were doing). Defaults to closing. */
  onVerified?: () => void;
  /** Asks again; resolves with the answer. When it comes back verified the pop-up closes itself. */
  onRecheck: () => Promise<VerifiedStatus>;
}

/** Shown instead of adding G$ or cashing out while the wallet is not verified with GoodDollar. */
export const VerifyGate: React.FC<Props> = ({ onClose, onVerified, onRecheck }) => {
  const [checking, setChecking] = useState(false);
  const [stillNot, setStillNot] = useState(false);
  const [couldNotCheck, setCouldNotCheck] = useState(false);

  const check = async () => {
    setChecking(true);
    setStillNot(false);
    setCouldNotCheck(false);
    const s = await onRecheck();
    setChecking(false);
    if (s === 'verified') (onVerified ?? onClose)();
    else if (s === 'not_verified') setStillNot(true);
    else setCouldNotCheck(true);
  };

  return (
    <Modal
      label="Verify with GoodDollar"
      title="One quick step: verify"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 10, width: '100%', flexWrap: 'wrap' }}>
          <a
            href={GOODDOLLAR_VERIFY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="gc-btn gc-btn--yellow gc-hit"
            style={{ height: 46, flex: '1 1 160px', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
          >
            Verify with GoodDollar
          </a>
          <button type="button" onClick={check} disabled={checking} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, flex: '1 1 160px' }}>
            {checking ? 'Checking…' : "I've verified, check again"}
          </button>
        </div>
      }
    >
      <p style={{ margin: '0 0 10px' }}>
        Verifying with GoodDollar is part of adding G$ and cashing out. It is quick, free, and only needs to be done once.
      </p>
      <p style={{ margin: 0 }}>When you are done, come back here and you will carry on from where you stopped.</p>
      {stillNot && (
        <p role="status" style={{ margin: '12px 0 0', fontWeight: 600 }}>
          GoodDollar does not show this wallet as verified yet. It can take a minute after you finish. Please try again shortly.
        </p>
      )}
      {couldNotCheck && (
        <p role="status" style={{ margin: '12px 0 0', fontWeight: 600 }}>
          We could not check right now. Please try again in a moment.
        </p>
      )}
    </Modal>
  );
};
