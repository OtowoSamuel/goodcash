import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { type VerifiedStatus } from '../lib/verified';
import { startGoodDollarVerification, verifyStartError, type VerifyIntent } from '../lib/goodid';
import { readBallot, type Ballot } from '../lib/vote';

/** How often the chain is asked while waiting for GoodDollar to record the verification */
export const VERIFY_POLL_MS = 10_000;
/** About three minutes of asking before offering to try again */
export const VERIFY_POLL_TRIES = 18;

interface Props {
  wallet: string;
  intent: VerifyIntent;
  /** Asks the chain (through our server) whether the wallet is verified */
  recheck: () => Promise<VerifiedStatus>;
  /** Verified, and the optional vote is done or skipped: take them to what they were doing */
  onDone: () => void;
  /** They chose to vote for GoodCash: open the vote screen (onDone follows when it closes) */
  onVote: () => void;
  onClose: () => void;
  /** For tests */
  start?: (wallet: string, intent: VerifyIntent) => Promise<void>;
  ballotOf?: (wallet: string) => Promise<Ballot>;
  pollMs?: number;
  tries?: number;
}

type Phase = 'checking' | 'timeout' | 'support';

/** The customer has just come back from GoodDollar's face check. */
export const VerifyReturn: React.FC<Props> = ({ wallet, intent, recheck, onDone, onVote, onClose, start = startGoodDollarVerification, ballotOf = readBallot, pollMs = VERIFY_POLL_MS, tries = VERIFY_POLL_TRIES }) => {
  const [phase, setPhase] = useState<Phase>('checking');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const finished = useRef(false);
  // The parent passes new callbacks on every render; the checking timer must not restart because of that, so it
  // always reads the latest ones from here.
  const latest = useRef({ recheck, onDone, ballotOf, intent, wallet });
  latest.current = { recheck, onDone, ballotOf, intent, wallet };

  const afterVerified = async () => {
    if (finished.current) return;
    finished.current = true;
    const { onDone: done, ballotOf: readB, intent: why, wallet: who } = latest.current;
    // Voting is optional and only offered to someone who has not voted for GoodCash yet
    if (why === 'vote') return done();
    try {
      const b = await readB(who);
      if (b.active && b.mine === 0) {
        setPhase('support');
        return;
      }
    } catch {
      // The ballot could not be read: skip the optional step rather than hold them up
    }
    latest.current.onDone();
  };

  // Ask now, then every pollMs, until verified or out of tries
  useEffect(() => {
    if (phase !== 'checking') return;
    let alive = true;
    let n = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      n += 1;
      setAttempt(n);
      const s = await latest.current.recheck();
      if (!alive) return;
      if (s === 'verified') return void afterVerified();
      if (n >= tries) return setPhase('timeout');
      timer = setTimeout(ask, pollMs);
    };
    void ask();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round, pollMs, tries]);

  const tryAgain = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await start(wallet, intent); // back to GoodDollar, signed by the same wallet
    } catch (e) {
      setProblem(verifyStartError(e));
      setBusy(false);
    }
  };

  if (phase === 'support') {
    return (
      <Modal
        label="Support GoodCash"
        title="You're verified 🎉"
        onClose={onDone}
        footer={
          <div style={{ display: 'flex', gap: 10, width: '100%', flexWrap: 'wrap' }}>
            <button type="button" onClick={onVote} className="gc-btn gc-btn--yellow gc-hit" style={{ height: 46, flex: '1 1 160px' }}>
              Vote for GoodCash
            </button>
            <button type="button" onClick={onDone} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, flex: '1 1 160px' }}>
              Skip for now
            </button>
          </div>
        }
      >
        <p style={{ margin: '0 0 10px' }}>
          <b>Optional:</b> support GoodCash in GoodBuilders. Verified GoodDollar members vote on which projects get funding, and one tap gives GoodCash all your voting points.
        </p>
        <p style={{ margin: 0 }}>Voting uses points, not G$. Only a small network fee is paid, in CELO. You can skip this and go straight on.</p>
      </Modal>
    );
  }

  const timedOut = phase === 'timeout';
  return (
    <Modal
      label="Checking your verification"
      title={timedOut ? 'Not verified yet' : 'Checking your verification'}
      onClose={onClose}
      footer={
        timedOut ? (
          <div style={{ display: 'flex', gap: 10, width: '100%', flexWrap: 'wrap' }}>
            <button type="button" onClick={tryAgain} disabled={busy} className="gc-btn gc-btn--yellow gc-hit" style={{ height: 46, flex: '1 1 160px' }}>
              {busy ? 'Check your wallet…' : 'Try again'}
            </button>
            <button type="button" onClick={() => { setPhase('checking'); setRound((r) => r + 1); }} disabled={busy} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, flex: '1 1 160px' }}>
              Check again
            </button>
          </div>
        ) : undefined
      }
    >
      {timedOut ? (
        <p style={{ margin: 0 }}>
          GoodDollar does not show this wallet as verified yet. If you did not finish the face check, tap <b>Try again</b>. If you just finished, give it a minute and tap <b>Check again</b>.
        </p>
      ) : (
        <p role="status" style={{ margin: 0 }}>
          Welcome back. We are checking with GoodDollar that your face check went through. This usually takes under a minute; we check every 10 seconds.
          <span style={{ display: 'block', marginTop: 8, fontSize: 13, opacity: 0.75 }}>Check {attempt} of {tries}</span>
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
