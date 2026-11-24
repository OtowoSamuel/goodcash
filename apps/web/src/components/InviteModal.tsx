import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { fetchReferralSummary, inviteLink, type ReferralSummary } from '../lib/referral';
import { fetchPaycrestRate, getCashoutRate } from '../lib/rate';
import { VoteNudge } from './VoteNudge';

const g = (n: number) => `G$ ${Math.round(n).toLocaleString('en-US')}`;
/** Rounded to the nearest ₦100 so it reads as the estimate it is */
const aboutNaira = (n: number) => `about ₦${(Math.round(n / 100) * 100).toLocaleString('en-US')}`;

/** Invite friends: the customer's own link, what they earn, and how their friends are doing. */
export const InviteModal: React.FC<{ wallet: string; onClose: () => void; onVote?: () => void }> = ({ wallet, onClose, onVote }) => {
  const [info, setInfo] = useState<ReferralSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ngnPerUsdt, setNgnPerUsdt] = useState<number | null>(null);
  const link = inviteLink(wallet);

  useEffect(() => {
    let alive = true;
    fetchReferralSummary(wallet).then((s) => alive && setInfo(s)).catch(() => alive && setFailed(true));
    fetchPaycrestRate().then((r) => alive && setNgnPerUsdt(r)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [wallet]);

  const rewardNaira = info && ngnPerUsdt ? getCashoutRate(info.rewardG, undefined, ngnPerUsdt).netNaira : NaN;
  const reward = info ? `${g(info.rewardG)}${Number.isFinite(rewardNaira) ? ` (${aboutNaira(rewardNaira)})` : ''}` : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // The link is also on screen to copy by hand
    }
  };
  const share = async () => {
    const text = 'Get free G$ every day with GoodDollar and cash it out to your bank with GoodCash. Start with my link:';
    try {
      if (navigator.share) await navigator.share({ text, url: link });
      else await copy();
    } catch {
      // The person closed the share sheet: nothing to do
    }
  };

  return (
    <Modal
      label="Invite friends"
      title="Invite friends"
      onClose={onClose}
      z={70}
      tone="white"
      footer={
        <button type="button" className="gc-btn gc-hit" style={{ height: 46, width: '100%' }} onClick={() => void share()}>
          Share my link
        </button>
      }
    >
      <div className="gc-note" style={info && !info.open ? undefined : { background: '#8cf0c0' }}>
        {info && !info.open ? (
          <>
            <b>The invite rewards have ended.</b> Thank you for sharing GoodCash. Your link still works as a normal link.
          </>
        ) : info ? (
          <>
            <b>Bring {info.perFriends} friends, get {reward}.</b> For every {info.perFriends} friends who join with your link, we send you{' '}
            {g(info.rewardG)} automatically. You can cash it out to your bank. Nobody pays anything.
          </>
        ) : (
          <>
            <b>Bring friends to GoodCash and get G$</b> you can cash out to your bank.
          </>
        )}
      </div>

      {info?.open && (
        <div className="gc-sm" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>A friend counts when they</div>
          <ol style={{ paddingLeft: 18, margin: 0 }}>
            <li>open your link and connect their wallet in GoodCash,</li>
            <li>verify with GoodDollar for the first time (free), and</li>
            <li>claim their free G$ once.</li>
          </ol>
          <div style={{ marginTop: 6 }}>
            Friends who were already verified with GoodDollar before they opened your link do not count. Each person counts once.
          </div>
        </div>
      )}

      {onVote && <VoteNudge wallet={wallet} onVote={onVote} style={{ marginTop: 12 }} />}

      <div className="gc-sm" style={{ marginTop: 12, marginBottom: 4, fontWeight: 800 }}>Your link</div>
      <div className="gc-note" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{link}</div>
      <button type="button" className="gc-btn gc-btn--white gc-hit" style={{ height: 42, width: '100%', marginTop: 8 }} onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy link'}
      </button>

      {info && (
        <div className="gc-sm" style={{ marginTop: 14 }} aria-live="polite">
          {!info.verified && (
            <div className="gc-note" style={{ marginBottom: 8 }}>
              Verify your own wallet with GoodDollar so your friends can count for you.
            </div>
          )}
          <div style={{ marginBottom: 6 }}>
            Friends who counted: <b>{info.friends}</b> of {info.maxFriends}
            {info.friends >= info.maxFriends ? ' (the most in this round)' : ''}
          </div>
          {info.waiting > 0 && (
            <div style={{ marginBottom: 6 }}>
              Joined, still to verify and claim: <b>{info.waiting}</b>
            </div>
          )}
          {info.paidG > 0 && (
            <div style={{ marginBottom: 6 }}>
              Sent to your wallet: <b>{g(info.paidG)}</b>
            </div>
          )}
          {info.pendingG > 0 && (
            <div style={{ marginBottom: 6 }}>
              On its way: <b>{g(info.pendingG)}</b>. It usually arrives within a day.
            </div>
          )}
        </div>
      )}
      {failed && <div className="gc-sm" style={{ marginTop: 12 }}>We could not load your numbers right now. Your link still works.</div>}
      {info?.open && (
        <div className="gc-sm" style={{ marginTop: 12, opacity: 0.8 }}>
          Up to {info.maxFriends} friends each. Rewards run until {new Date(info.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} or
          until the reward budget is used up.
        </div>
      )}
    </Modal>
  );
};
