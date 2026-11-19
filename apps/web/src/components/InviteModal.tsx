import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { fetchReferralSummary, inviteLink, type ReferralSummary } from '../lib/referral';

const g = (n: number) => `G$ ${Math.round(n).toLocaleString('en-US')}`;
const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-US')}`;

/** Invite a friend: the customer's own link, what both of them get, and how many friends have joined. */
export const InviteModal: React.FC<{ wallet: string; onClose: () => void }> = ({ wallet, onClose }) => {
  const [info, setInfo] = useState<ReferralSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = inviteLink(wallet);

  useEffect(() => {
    let alive = true;
    fetchReferralSummary(wallet).then((s) => alive && setInfo(s)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [wallet]);

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
    const text = info?.open
      ? `Add money to GoodCash for the first time and get ${g(info.friendBonusG)} free. Use my link:`
      : 'Join me on GoodCash. Use my link:';
    try {
      if (navigator.share) await navigator.share({ text, url: link });
      else await copy();
    } catch {
      // The person closed the share sheet: nothing to do
    }
  };

  return (
    <Modal
      label="Invite a friend"
      title="Invite a friend"
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
            <b>You both get G$.</b> When a friend uses your link and adds at least {naira(info.minNaira)} for the first time, they get{' '}
            <b>{g(info.friendBonusG)}</b> and you get <b>{g(info.perFriendG)}</b>.
          </>
        ) : (
          <>
            <b>You both get G$</b> when a friend uses your link and adds money for the first time.
          </>
        )}
      </div>

      <div className="gc-sm" style={{ marginTop: 12, marginBottom: 4, fontWeight: 800 }}>Your link</div>
      <div className="gc-note" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{link}</div>
      <button type="button" className="gc-btn gc-btn--white gc-hit" style={{ height: 42, width: '100%', marginTop: 8 }} onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy link'}
      </button>

      {info && (
        <div className="gc-sm" style={{ marginTop: 14 }} aria-live="polite">
          <div style={{ marginBottom: 8 }}>
            Friends who have added money: <b>{info.friends}</b>
            {info.friends >= info.maxFriends ? ' (the most we can reward in this round)' : ''}
          </div>
          {info.earnedG > 0 && (
            <div style={{ marginBottom: 8 }}>
              You have earned <b>{g(info.earnedG)}</b>. We check each reward and send it to your wallet by hand, so it can take a few days.
            </div>
          )}
          {info.bonusG > 0 && (
            <div>
              Your own bonus of <b>{g(info.bonusG)}</b> is on its way, after the same check.
            </div>
          )}
        </div>
      )}
      {failed && <div className="gc-sm" style={{ marginTop: 12 }}>We could not load your numbers right now. Your link still works.</div>}
      <div className="gc-sm" style={{ marginTop: 12, opacity: 0.8 }}>
        Rewards go only to wallets verified with GoodDollar, once per person. Links made to claim rewards over and over are not paid.
      </div>
    </Modal>
  );
};
