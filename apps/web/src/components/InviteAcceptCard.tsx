import React, { useState } from 'react';
import { acceptInvite, inviteHandled, savedReferral, type AcceptResult } from '../lib/referral';
import { getWalletProvider } from '../lib/router';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Someone opened a friend's invite link. They accept it with a free signature from their own wallet, which proves it
 * was their choice (nobody else can sign up their wallet under a link). Shown until it is accepted or does not apply.
 */
export const InviteAcceptCard: React.FC<{
  wallet: string;
  accept?: (wallet: string) => Promise<AcceptResult>;
}> = ({ wallet, accept }) => {
  const ref = savedReferral(wallet);
  const [hidden, setHidden] = useState(() => !ref || inviteHandled(wallet));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (hidden || !ref) return null;

  const go = async () => {
    setBusy(true);
    setNote(null);
    try {
      const provider = getWalletProvider();
      const out = accept ? await accept(wallet) : provider ? await acceptInvite(wallet, provider) : 'failed';
      if (out === 'joined' || out === 'already') {
        setNote('Invite accepted. Verify with GoodDollar and claim your free G$ below, and your friend gets a reward.');
      } else if (out === 'not_new') {
        setNote('This invite is for people new to GoodDollar. You can still use everything in GoodCash as normal.');
      } else if (out === 'ended') {
        setNote('The invite rewards have ended. You can still use everything in GoodCash as normal.');
      } else {
        setNote('We could not accept the invite right now. Please try again.');
      }
      if (out !== 'failed') setTimeout(() => setHidden(true), 6000);
    } catch (e) {
      const code = (e as { code?: number })?.code;
      setNote(code === 4001 || /reject|denied|cancel/i.test(String((e as Error)?.message)) ? 'You cancelled in your wallet. Tap Accept to try again.' : 'We could not accept the invite right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gc-card gc-card--ye gc-claim" data-testid="invite-accept">
      <div className="gc-claim__text">
        <div className="gc-lab">A friend invited you</div>
        <div className="gc-sm" style={{ marginTop: 2 }} aria-live="polite">
          {note ?? (
            <>
              Accept the invite from <b>{short(ref)}</b> before you verify. Your wallet signs a free message. No money is sent.
            </>
          )}
        </div>
      </div>
      {!note?.startsWith('Invite accepted') && !note?.startsWith('This invite') && !note?.startsWith('The invite') && (
        <button type="button" className="gc-btn gc-btn--white gc-hit gc-claim__btn" onClick={() => void go()} disabled={busy} aria-busy={busy}>
          {busy ? 'Check wallet…' : 'Accept'}
        </button>
      )}
    </div>
  );
};
