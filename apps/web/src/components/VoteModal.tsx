import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { startGoodDollarVerification, verifyStartError } from '../lib/goodid';
import { celoText } from '../lib/router';
import {
  askForVoteFee,
  type SignedProof,
  type Ballot,
  checkCouncilCode,
  confirmVote,
  estimateBestVote,
  friendlyVoteError,
  loadPendingVote,
  planVote,
  readBallot,
  readVerified,
  registerVoter,
  savePendingVote,
  sendVote,
  VOTE_CHAIN_ID,
  VOTE_COUNCIL,
  waitForFee,
  type RegisterOutcome,
  type VoteFee,
  type VoteTotals,
} from '../lib/vote';

const COUNCIL_PAGE = `https://flowstate.network/flow-councils/${VOTE_CHAIN_ID}/${VOTE_COUNCIL}`;

type Phase = 'loading' | 'unavailable' | 'ready' | 'registering' | 'sending' | 'confirming' | 'done' | 'unclear';

const registerMessage: Record<Exclude<RegisterOutcome, 'registered'>, string> = {
  not_verified: 'GoodDollar has not verified this wallet yet. Finish the face check in GoodWallet, then tap check again.',
  other_wallet: 'This GoodDollar account has already used its vote from another wallet. Please vote from that wallet.',
  busy: 'Voting is busy right now. Please try again in a minute.',
  error: 'We could not set up your vote just now. Nothing was taken. Please try again.',
};

/**
 * Vote for GoodCash in the GoodBuilders programme without leaving the app. Free of G$: it uses voting points.
 *
 * Two steps for the customer: 1. be verified with GoodDollar, 2. vote. A first-time voter taps one Vote button;
 * we set up their voting points in the background (one free signature) and carry straight on to their vote.
 */
export const VoteModal: React.FC<{ wallet: string; onClose: () => void; onAddCelo?: () => void }> = ({ wallet, onClose, onAddCelo }) => {
  const [phase, setPhase] = useState<Phase>('loading');
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [points, setPoints] = useState(0);
  // The fee is worked out for one particular vote; it stays valid until the chosen points change
  // `totals` is the vote that was checked (the shared one, or all to GoodCash if sharing would be refused): send exactly that
  const [feeState, setFeeState] = useState<{ for: string; fee: VoteFee | null; totals: VoteTotals | null; failed: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [gave, setGave] = useState<{ gc: number; gb: number }>({ gc: 0, gb: 0 });
  // A first-time voter pressed Vote: once their points are set up and the fee is fine, the vote goes on by itself
  const [continueVote, setContinueVote] = useState(false);
  // Verifying signs with this same wallet on our site, then GoodDollar's face check, then back here
  const [verifying, setVerifying] = useState(false);
  const [verifyProblem, setVerifyProblem] = useState<string | null>(null);
  const verifyNow = async () => {
    setVerifying(true);
    setVerifyProblem(null);
    try {
      await startGoodDollarVerification(wallet, 'vote');
    } catch (e) {
      setVerifyProblem(verifyStartError(e));
      setVerifying(false);
    }
  };
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
      // Stop before anything is signed if the voting contract is not the one we checked
      await checkCouncilCode();
      const b = await readBallot(wallet);
      // A wallet with voting points is verified by definition. Otherwise ask GoodDollar.
      const v = b.registered ? true : await readVerified(wallet);
      if (!alive.current) return;
      setBallot(b);
      setVerified(v);
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
    const r = await confirmVote(pending.hash, { newTotal: pending.newTotal, partnerTotal: pending.partnerTotal }, wallet);
    if (!alive.current) return true;
    if (r.status === 'done') {
      savePendingVote(wallet, null);
      setGave({ gc: r.ballot.mine, gb: pending.partnerTotal === null ? 0 : r.ballot.partnerMine });
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
  const planned = plan && plan.ok ? `${plan.newTotal}/${plan.partnerTotal}` : null;
  const feeNow = feeState && feeState.for === planned ? feeState : null;
  const fee = feeNow?.fee ?? null;
  const checked = feeNow?.totals ?? null;
  const feeFailed = feeNow?.failed === true;
  // The plan is worked out from ballot and points on every render; `planned` stands for it in the effect below
  const planRef = useRef(plan);
  planRef.current = plan;
  useEffect(() => {
    const p = planRef.current;
    if (phase !== 'ready' || planned === null || !p || !p.ok || feeState?.for === planned) return;
    let live = true;
    const t = setTimeout(() => {
      estimateBestVote(wallet, p)
        .then((r) => live && setFeeState({ for: planned, fee: r.fee, totals: r.totals, failed: false }))
        .catch(() => live && setFeeState({ for: planned, fee: null, totals: null, failed: true }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [phase, planned, wallet, feeState]);

  const castVote = useCallback(
    async (totals: VoteTotals, gas: bigint) => {
      setNote(null);
      setPhase('sending');
      try {
        const hash = await sendVote(wallet, totals, gas);
        if (!alive.current) return;
        setPhase('confirming');
        const r = await confirmVote(hash, totals, wallet);
        if (!alive.current) return;
        if (r.status === 'done') {
          savePendingVote(wallet, null);
          setGave({ gc: r.ballot.mine, gb: totals.partnerTotal === null ? 0 : r.ballot.partnerMine });
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
    },
    [wallet, load],
  );

  // GoodCash sends the small network fee once, by itself, when they tap Vote and their wallet is short. Their wallet only
  // asks for a free message. After that, or when it is off or empty, only the naira option is left.
  const [gettingFee, setGettingFee] = useState(false);
  const [feeGiftGone, setFeeGiftGone] = useState(false);
  const feeAsked = useRef(false);
  const claimProof = useRef<SignedProof | null>(null);
  /** true when the fee has arrived */
  const ensureFee = useCallback(
    async (needCelo: number): Promise<boolean> => {
      setGettingFee(true);
      setNote(null);
      try {
        const outcome = await askForVoteFee(wallet, undefined, undefined, claimProof.current);
        if (!alive.current) return false;
        if (outcome === 'sent' || outcome === 'enough') {
          const arrived = await waitForFee(wallet, needCelo);
          if (!alive.current) return false;
          if (!arrived) setNote('The network fee is on its way. Tap Vote again in a minute.');
          return arrived;
        }
        if (outcome === 'not_verified') setNote('GoodDollar has not verified this wallet yet, so we cannot send the network fee.');
        else if (outcome === 'busy') setNote('This is busy right now. Please try again in a minute.');
        else if (outcome === 'error') setNote('We could not send the network fee just now. Nothing was taken. Please try again.');
        else {
          setFeeGiftGone(true);
          setNote(outcome === 'already' ? 'GoodCash has already sent you the network fee once. Add a little CELO with naira to vote.' : 'GoodCash cannot send the network fee right now. You can add a little CELO with naira instead.');
        }
        return false;
      } catch (e) {
        if (alive.current) setNote(friendlyVoteError(e));
        return false;
      } finally {
        if (alive.current) setGettingFee(false);
      }
    },
    [wallet],
  );

  // After a first-time voter's points are set up: carry on to the vote, but only when it is safe to. If the wallet
  // cannot pay the fee, or the fee cannot be checked, stop and show the normal screen so they can fix that first.
  useEffect(() => {
    if (!continueVote || phase !== 'ready') return;
    // Short of CELO and GoodCash can send it: ask once, then look again
    if (fee && !fee.enough && !feeGiftGone && !feeAsked.current) {
      feeAsked.current = true;
      void ensureFee(fee.needCelo).then((arrived) => {
        if (!alive.current) return;
        if (arrived) setFeeState(null);
        else setContinueVote(false);
      });
      return;
    }
    if (gettingFee) return;
    if (feeFailed || (fee && !fee.enough)) {
      setContinueVote(false);
      setNote(fee && !fee.enough ? 'Your voting is set up. Add a little CELO for the network fee, then tap Vote.' : null);
      return;
    }
    if (fee && checked) {
      setContinueVote(false);
      void castVote(checked, fee.gas);
    }
  }, [continueVote, phase, fee, feeFailed, checked, castVote, feeGiftGone, gettingFee, ensureFee]);

  const vote = async () => {
    if (!ballot) return;
    // A first-time voter: set up their voting points first (one free signature), then carry on to the vote with all of them
    if (!ballot.registered) {
      setNote(null);
      setPhase('registering');
      try {
        const outcome = await registerVoter(wallet, undefined, undefined, claimProof);
        if (outcome !== 'registered') {
          setNote(registerMessage[outcome]);
          if (outcome === 'not_verified') setVerified(false);
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
            setFeeState(null);
            setContinueVote(true);
            setPhase('ready');
            return;
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        setNote('Your voting is being set up. Please tap Check again in a minute.');
        await load();
      } catch (e) {
        if (!alive.current) return;
        setNote(friendlyVoteError(e));
        setPhase('ready');
      }
      return;
    }
    if (!plan || !plan.ok || !fee || !checked) return;
    if (!fee.enough) {
      // GoodCash sends the fee, then the vote carries on by itself
      if (feeGiftGone) return;
      feeAsked.current = true;
      if (await ensureFee(fee.needCelo)) {
        setFeeState(null);
        setContinueVote(true);
      }
      return;
    }
    await castVote(checked, fee.gas);
  };

  const busy = phase === 'registering' || phase === 'sending' || phase === 'confirming' || continueVote || gettingFee;
  const registered = !!ballot && ballot.registered;
  const needsVerify = phase === 'ready' && !!ballot && ballot.active && !registered && verified === false;
  const firstVote = phase === 'ready' && !!ballot && ballot.active && !registered && verified === true;
  const noPointsLeft = phase === 'ready' && registered && !!ballot && ballot.available < 1;
  const canVote = phase === 'ready' && !!plan && plan.ok && !!fee && (fee.enough || !feeGiftGone);

  const primary = (label: string, onClick: () => void, enabled: boolean) => (
    <button type="button" onClick={onClick} disabled={!enabled || busy} className={`gc-btn gc-hit ${enabled && !busy ? '' : 'gc-btn--dis'}`} style={{ height: 46, width: '100%' }}>
      {busy ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="w-4 h-4 rounded-full border-[3px] border-current border-t-transparent animate-spin" aria-hidden="true" />
          {gettingFee ? 'Sending you the network fee…' : phase === 'sending' ? 'Approve in your wallet…' : phase === 'registering' ? 'Setting up your vote…' : 'Confirming…'}
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
  else if (needsVerify) footer = primary("I've verified, check again", () => void load(), true);
  else if (firstVote) footer = primary('Vote', () => void vote(), true);
  else if (phase === 'ready' && plan?.ok) footer = primary(`Vote with ${points} ${points === 1 ? 'point' : 'points'}`, () => void vote(), canVote);
  else if (busy) footer = primary('', () => undefined, false);
  else footer = primary('Close', onClose, true);

  const showSteps = phase !== 'loading' && phase !== 'unavailable' && !!ballot && ballot.active;
  const stepStyle = (done: boolean, active: boolean): React.CSSProperties => ({ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', fontWeight: 800, opacity: done || active ? 1 : 0.55 });
  const badge = (done: boolean, n: number) => (
    <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 13, border: '2px solid #111', background: done ? '#8cf0c0' : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flex: '0 0 auto' }}>
      {done ? '✓' : n}
    </span>
  );

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

      {showSteps && (
        <ol style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }} aria-label="Steps">
          <li style={stepStyle(verified === true || registered, needsVerify)}>
            {badge(verified === true || registered, 1)}
            <span>Verify with GoodDollar{verified === true || registered ? ' (done)' : ''}</span>
          </li>
          <li style={stepStyle(phase === 'done', !needsVerify)}>
            {badge(phase === 'done', 2)}
            <span>Vote for GoodCash</span>
          </li>
        </ol>
      )}

      {needsVerify && (
        <div style={{ marginTop: 8 }}>
          <div className="gc-sm">
            To vote, you must be verified with GoodDollar. Your wallet approves a free message (no money), GoodDollar opens for a short face check, then brings you back here to vote.
          </div>
          <button type="button" onClick={() => void verifyNow()} disabled={verifying} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, width: '100%', marginTop: 10 }}>
            {verifying ? 'Check your wallet…' : 'Verify with GoodDollar'}
          </button>
          {verifyProblem && <div className="gc-sm" role="status" style={{ marginTop: 8, fontWeight: 600 }}>{verifyProblem}</div>}
        </div>
      )}

      {firstVote && (
        <div className="gc-sm" style={{ marginTop: 8 }}>
          You are verified. Tap <b>Vote</b> and we set up your voting points, then vote with all of them, shared between GoodCash and GoodBuildIt, a fellow GoodDollar project. Your wallet will ask you to approve two things: a free message first (no money), then the vote.
        </div>
      )}

      {phase === 'ready' && registered && ballot && ballot.mine > 0 && (
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

      {phase === 'ready' && registered && ballot && ballot.available >= 1 && (
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
          {checked && (
            <div className="gc-sm" style={{ marginTop: 8 }}>
              {checked.partnerTotal === null ? (
                <>All {points} {points === 1 ? 'point goes' : 'points go'} to GoodCash.</>
              ) : (
                <>
                  Your points are shared with GoodBuildIt, a fellow GoodDollar project that shares its voters&apos; points with us too:{' '}
                  <b>{checked.newTotal - ballot.mine}</b> to GoodCash and <b>{checked.partnerTotal - ballot.partnerMine}</b> to GoodBuildIt.
                </>
              )}
            </div>
          )}
          <div className="gc-sm" style={{ marginTop: 8 }} aria-live="polite">
            {fee ? (
              <>
                Network fee: about <b>{celoText(fee.feeCelo)} CELO</b>.{' '}
                {fee.enough ? (
                  <>Your wallet has enough.</>
                ) : (
                  <>
                    You need about <b>{celoText(fee.needCelo)} CELO</b> and have {celoText(fee.haveCelo)}.{' '}
                    {!feeGiftGone && <>When you tap Vote, GoodCash sends you this fee for free (once). Your wallet will ask you to approve a free message first.</>}
                    {feeGiftGone && onAddCelo && (
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
          <b>Thank you!</b> GoodCash now has {gave.gc} {gave.gc === 1 ? 'point' : 'points'} from you
          {gave.gb > 0 ? <>, and GoodBuildIt has {gave.gb}</> : null}.
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
