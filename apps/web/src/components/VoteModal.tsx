import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { celoText } from '../lib/router';
import {
  type Ballot,
  confirmVote,
  estimateVoteFee,
  friendlyVoteError,
  loadPendingVote,
  planVote,
  readBallot,
  registerVoter,
  savePendingVote,
  sendVote,
  VOTE_CHAIN_ID,
  VOTE_COUNCIL,
  type RegisterOutcome,
  type VoteFee,
} from '../lib/vote';

const COUNCIL_PAGE = `https://flowstate.network/flow-councils/${VOTE_CHAIN_ID}/${VOTE_COUNCIL}`;

type Phase = 'loading' | 'unavailable' | 'ready' | 'registering' | 'sending' | 'confirming' | 'done' | 'unclear';

const registerMessage: Record<Exclude<RegisterOutcome, 'registered'>, string> = {
  not_verified: 'GoodDollar has not verified this wallet yet. Finish the verification in the GoodDollar app, then come back and try again.',
  other_wallet: 'This GoodDollar account has already used its vote from another wallet. Please vote from that wallet.',
  busy: 'Voting is busy right now. Please try again in a minute.',
  error: 'We could not turn on voting just now. Nothing was taken. Please try again.',
};

/** Vote for GoodCash in the GoodBuilders programme without leaving the app. Free: it uses voting points, not G$. */
export const VoteModal: React.FC<{ wallet: string; onClose: () => void; onAddCelo?: () => void }> = ({ wallet, onClose, onAddCelo }) => {
  const [phase, setPhase] = useState<Phase>('loading');
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [points, setPoints] = useState(0);
  // The fee is worked out for one particular vote; it stays valid until the chosen points change
  const [feeState, setFeeState] = useState<{ for: number; fee: VoteFee | null; failed: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [gave, setGave] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const b = await readBallot(wallet);
      if (!alive.current) return;
      setBallot(b);
      setPoints(b.available);
      setPhase('ready');
    } catch {
      if (alive.current) setPhase('unavailable');
    }
  }, [wallet]);

  // A vote sent earlier and not yet confirmed is followed, never sent again
  const followPending = useCallback(async () => {
    const pending = loadPendingVote(wallet);
    if (!pending) return false;
    setPhase('confirming');
    const r = await confirmVote(pending.hash, pending.newTotal, wallet);
    if (!alive.current) return true;
    if (r.status === 'done') {
      savePendingVote(wallet, null);
      setGave(r.ballot.mine);
      setBallot(r.ballot);
      setPhase('done');
    } else if (r.status === 'failed') {
      savePendingVote(wallet, null);
      setNote('That vote did not go through, and nothing was taken. You can try again.');
      await load();
    } else {
      setPhase('unclear');
    }
    return true;
  }, [wallet, load]);

  useEffect(() => {
    void (async () => {
      if (!(await followPending())) await load();
    })();
  }, [followPending, load]);

  // The network fee for the vote as chosen. Worked out a moment after the slider stops.
  const plan = ballot ? planVote(ballot, points) : null;
  const planned = plan && plan.ok ? plan.newTotal : null;
  const feeNow = feeState && feeState.for === planned ? feeState : null;
  const fee = feeNow?.fee ?? null;
  const feeFailed = feeNow?.failed === true;
  useEffect(() => {
    if (phase !== 'ready' || planned === null || feeState?.for === planned) return;
    let live = true;
    const t = setTimeout(() => {
      estimateVoteFee(wallet, planned)
        .then((f) => live && setFeeState({ for: planned, fee: f, failed: false }))
        .catch(() => live && setFeeState({ for: planned, fee: null, failed: true }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [phase, planned, wallet, feeState]);

  const turnOnVoting = async () => {
    setNote(null);
    setPhase('registering');
    try {
      const outcome = await registerVoter(wallet);
      if (outcome !== 'registered') {
        setNote(registerMessage[outcome]);
        setPhase('ready');
        return;
      }
      // Flow State has waited for the chain, but a node can be a moment behind: look a few times
      for (let i = 0; i < 4; i++) {
        const b = await readBallot(wallet);
        if (!alive.current) return;
        if (b.registered) {
          setBallot(b);
          setPoints(b.available);
          setPhase('ready');
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      setNote('Voting is being turned on. Please check again in a minute.');
      await load();
    } catch (e) {
      if (!alive.current) return;
      setNote(friendlyVoteError(e));
      setPhase('ready');
    }
  };

  const vote = async () => {
    if (!plan || !plan.ok || !fee || !fee.enough) return;
    setNote(null);
    setPhase('sending');
    try {
      const hash = await sendVote(wallet, plan.newTotal, fee.gas);
      if (!alive.current) return;
      setPhase('confirming');
      const r = await confirmVote(hash, plan.newTotal, wallet);
      if (!alive.current) return;
      if (r.status === 'done') {
        savePendingVote(wallet, null);
        setGave(r.ballot.mine);
        setBallot(r.ballot);
        setPhase('done');
      } else if (r.status === 'failed') {
        savePendingVote(wallet, null);
        setNote('That vote did not go through, and nothing was taken. You can try again.');
        await load();
      } else {
        setPhase('unclear');
      }
    } catch (e) {
      if (!alive.current) return;
      setNote(friendlyVoteError(e));
      setPhase('ready');
    }
  };

  const busy = phase === 'registering' || phase === 'sending' || phase === 'confirming';
  const canVote = phase === 'ready' && !!plan && plan.ok && !!fee && fee.enough;
  const needsRegister = phase === 'ready' && !!ballot && ballot.active && !ballot.registered;
  const noPointsLeft = phase === 'ready' && !!ballot && ballot.registered && ballot.available < 1;

  const primary = (label: string, onClick: () => void, enabled: boolean) => (
    <button type="button" onClick={onClick} disabled={!enabled || busy} className={`gc-btn gc-hit ${enabled && !busy ? '' : 'gc-btn--dis'}`} style={{ height: 46, width: '100%' }}>
      {busy ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="w-4 h-4 rounded-full border-[3px] border-current border-t-transparent animate-spin" aria-hidden="true" />
          {phase === 'sending' ? 'Approve in your wallet…' : phase === 'registering' ? 'Turning on voting…' : 'Confirming…'}
        </span>
      ) : (
        label
      )}
    </button>
  );

  let footer: React.ReactNode;
  if (phase === 'done') footer = primary('Done', onClose, true);
  else if (phase === 'unclear') footer = primary('Check again', () => void followPending(), true);
  else if (phase === 'unavailable') footer = primary('Try again', () => void load(), true);
  else if (needsRegister) footer = primary('Turn on voting', () => void turnOnVoting(), true);
  else if (phase === 'ready' && plan?.ok) footer = primary(`Vote with ${points} ${points === 1 ? 'point' : 'points'}`, () => void vote(), canVote);
  else if (busy) footer = primary('', () => undefined, false);
  else footer = primary('Close', onClose, true);

  return (
    <Modal label="Vote for GoodCash" title="Vote for GoodCash" onClose={busy ? () => undefined : onClose} z={70} tone="white" footer={footer}>
      <div className="gc-note" style={{ background: '#8cf0c0' }}>
        <b>Voting is free.</b> GoodCash is in the GoodBuilders programme, and verified GoodDollar members help decide how much funding each project gets. Your vote uses voting points, not G$. Only a small network fee is paid, in CELO.
      </div>

      {phase === 'loading' && <div className="gc-sm" style={{ marginTop: 12 }} role="status">Checking your wallet…</div>}

      {phase === 'unavailable' && <div className="gc-sm" style={{ marginTop: 12 }}>We could not check voting right now. Please try again.</div>}

      {phase !== 'loading' && phase !== 'unavailable' && ballot && !ballot.active && (
        <div className="gc-note" style={{ marginTop: 12 }}>Voting for GoodCash is not open right now. Please check back soon.</div>
      )}

      {needsRegister && (
        <div className="gc-sm" style={{ marginTop: 12 }}>
          To vote, your wallet must be verified with GoodDollar. Tap <b>Turn on voting</b> and sign a free message in your wallet. It costs nothing and sends no money. Then you will get your voting points.
        </div>
      )}

      {phase === 'ready' && ballot && ballot.registered && ballot.mine > 0 && (
        <div className="gc-note" style={{ marginTop: 12 }}>
          <b>You already support GoodCash</b> with {ballot.mine} {ballot.mine === 1 ? 'point' : 'points'}. Thank you!
        </div>
      )}

      {noPointsLeft && ballot && ballot.mine === 0 && (
        <div className="gc-sm" style={{ marginTop: 12 }}>
          You have used all {ballot.power} of your voting points on other projects. To give some to GoodCash, move them on{' '}
          <a href={COUNCIL_PAGE} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', fontWeight: 800 }}>Flow State</a>.
        </div>
      )}

      {phase === 'ready' && ballot && ballot.registered && ballot.available >= 1 && (
        <div style={{ marginTop: 14 }}>
          <label htmlFor="gc-vote-points" className="gc-sm" style={{ fontWeight: 800, display: 'block' }}>
            How many points do you want to give? <span style={{ fontSize: 20 }}>{points}</span> of {ballot.available}
          </label>
          <input
            id="gc-vote-points"
            type="range"
            min={1}
            max={ballot.available}
            step={1}
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
            disabled={ballot.available === 1}
            style={{ width: '100%', marginTop: 8, accentColor: '#7c3aed', height: 32 }}
          />
          <div className="gc-sm" style={{ marginTop: 8 }} aria-live="polite">
            {fee ? (
              <>
                Network fee: about <b>{celoText(fee.feeCelo)} CELO</b>.{' '}
                {fee.enough ? (
                  <>Your wallet has enough.</>
                ) : (
                  <>
                    You need about <b>{celoText(fee.needCelo)} CELO</b> and have {celoText(fee.haveCelo)}.{' '}
                    {onAddCelo && (
                      <button type="button" className="gc-btn gc-btn--white gc-hit" style={{ height: 42, width: '100%', marginTop: 8 }} onClick={onAddCelo}>
                        Add CELO with naira
                      </button>
                    )}
                  </>
                )}
              </>
            ) : feeFailed ? (
              <>
                We cannot send a vote right now.{' '}
                <button type="button" onClick={() => setFeeState(null)} style={{ textDecoration: 'underline', fontWeight: 800 }}>
                  Check again
                </button>
              </>
            ) : (
              'Checking the network fee…'
            )}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="gc-note" style={{ background: '#8cf0c0', marginTop: 12 }} role="status">
          <b>Thank you!</b> GoodCash now has {gave} {gave === 1 ? 'point' : 'points'} from you.
        </div>
      )}

      {phase === 'unclear' && (
        <div className="gc-note" style={{ marginTop: 12 }}>
          <b>We could not confirm your vote yet.</b> Please do not vote again. Tap <b>Check again</b> in a minute. If it went through, it will show here.
        </div>
      )}

      {note && (
        <div className="gc-sm" style={{ marginTop: 12 }} role="alert">
          {note}
        </div>
      )}

      <div className="gc-sm" style={{ marginTop: 14, opacity: 0.8 }}>
        You sign everything in your own wallet. GoodCash never holds your keys or your G$.
      </div>
    </Modal>
  );
};
