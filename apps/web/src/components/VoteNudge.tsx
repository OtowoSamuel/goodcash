import React, { useEffect, useState } from 'react';
import { readBallot } from '../lib/vote';

/**
 * "Vote for GoodCash": a small, optional ask, shown only to someone who has not given GoodCash any points yet.
 * Nothing depends on it: no reward is tied to voting.
 */
export const VoteNudge: React.FC<{ wallet: string; onVote: () => void; ballotOf?: typeof readBallot; style?: React.CSSProperties }> = ({
  wallet,
  onVote,
  ballotOf = readBallot,
  style,
}) => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let alive = true;
    setShow(false);
    ballotOf(wallet)
      .then((b) => alive && setShow(b.active && b.mine === 0))
      .catch(() => undefined); // unreadable: say nothing
    return () => {
      alive = false;
    };
  }, [wallet, ballotOf]);
  if (!show) return null;
  return (
    <div className="gc-note gc-vote-nudge" style={style} data-testid="vote-nudge">
      <span>
        <b>Vote for GoodCash.</b> It's free.
      </span>
      <button type="button" className="gc-btn gc-btn--yellow gc-hit gc-vote-nudge__btn" onClick={onVote}>
        Vote
      </button>
    </div>
  );
};
