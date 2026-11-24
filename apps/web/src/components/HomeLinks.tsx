import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { getTranslations, type Language } from '../lib/i18n';
import { BLOCKSCOUT_URL, SHORT_ROUTER_ADDRESS } from './SafetyBanner';
import { InviteModal } from './InviteModal';
import { VoteModal } from './VoteModal';

type Sheet = 'how' | 'costs' | 'safe';

/**
 * Help, Invite and Vote are things people look for once in a while, so Home shows a single "More" link. It opens one
 * sheet with every option (and About, Privacy and Terms), and each option opens its own pop-up.
 */
export const HomeLinks: React.FC<{ language: Language; wallet?: string | null; onAddCelo?: () => void; openCosts?: number }> = ({ language, wallet, onAddCelo, openCosts = 0 }) => {
  const t = getTranslations(language);
  const [open, setOpen] = useState<Sheet | null>(null);
  const [inviting, setInviting] = useState(false);
  const [voting, setVoting] = useState(false);
  const [more, setMore] = useState(false);
  const items: Array<[Sheet, string]> = [
    ['how', t.howItWorks],
    ['costs', t.whatItCostsPanel],
    ['safe', t.staySafe],
  ];
  const label = (s: Sheet) => items.find(([k]) => k === s)![1];
  // "See breakdown" on the balance card opens "What it costs"
  useEffect(() => {
    if (openCosts > 0) setOpen('costs');
  }, [openCosts]);


  return (
    <>
      {/* Desktop: the five links as pills, as before */}
      <div className="gc-pills gc-only-desk" role="group" aria-label="More about GoodCash">
        {items.map(([k, text]) => (
          <button key={k} type="button" className="gc-pill-btn gc-hit" onClick={() => setOpen(k)}>
            {text}
          </button>
        ))}
        {wallet && (
          <button type="button" className="gc-pill-btn gc-hit" onClick={() => setInviting(true)}>
            Invite friends
          </button>
        )}
        {wallet && (
          <button type="button" className="gc-pill-btn gc-hit" onClick={() => setVoting(true)}>
            Vote for GoodCash
          </button>
        )}
      </div>
      {/* Phones: one calm "More" link that opens a sheet with all of them */}
      <div className="gc-more-row gc-only-phone">
        <button type="button" className="gc-more gc-hit" onClick={() => setMore(true)} aria-haspopup="dialog">
          More
          <svg viewBox="0 0 24 24" aria-hidden="true" className="gc-more__icon"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {more && (
        <Modal label="More" title="More" onClose={() => setMore(false)} z={70} tone="white">
          <div className="gc-menu">
            {items.map(([k, text]) => (
              <button key={k} type="button" className="gc-menu__item" onClick={() => { setMore(false); setOpen(k); }}>
                <span>{text}</span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
            {wallet && (
              <button type="button" className="gc-menu__item" onClick={() => { setMore(false); setInviting(true); }}>
                <span>
                  Invite friends
                  <span className="gc-menu__sub">Earn G$ for every 2 friends who join</span>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            )}
            {wallet && (
              <button type="button" className="gc-menu__item" onClick={() => { setMore(false); setVoting(true); }}>
                <span>
                  Vote for GoodCash
                  <span className="gc-menu__sub">Free, takes a minute</span>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            )}
          </div>
          <div className="gc-sm gc-menu__legal">
            <a href="/about" target="_blank" rel="noopener noreferrer">About</a>
            {' · '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
            {' · '}
            <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>
          </div>
        </Modal>
      )}
      {inviting && wallet && <InviteModal wallet={wallet} onClose={() => setInviting(false)} onVote={() => { setInviting(false); setVoting(true); }} />}
      {voting && wallet && (
        <VoteModal
          wallet={wallet}
          onClose={() => setVoting(false)}
          onAddCelo={onAddCelo ? () => { setVoting(false); onAddCelo(); } : undefined}
        />
      )}
      {open && (
        <Modal label={label(open)} title={label(open)} onClose={() => setOpen(null)} z={70} tone="white" footer={
          <button type="button" className="gc-btn gc-hit" style={{ height: 46, width: '100%' }} onClick={() => setOpen(null)}>
            Got it
          </button>
        }>
          {open === 'how' && (
            <>
              {[t.howItWorksStep1, t.howItWorksStep2, t.howItWorksStep3].map((step, i) => (
                <div key={i} className="gc-st">
                  <b className="gc-st__num">{i + 1}</b>
                  <span className="gc-sm">{step}</span>
                </div>
              ))}
            </>
          )}
          {open === 'costs' && <div className="gc-note">{t.whatItCostsExplanation}</div>}
          {open === 'safe' && (
            <div className="gc-note" style={{ background: '#8cf0c0' }}>
              {t.staySafeText}{' '}
              <a href={BLOCKSCOUT_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', fontWeight: 800 }}>
                Contract {SHORT_ROUTER_ADDRESS} ↗
              </a>
            </div>
          )}
        </Modal>
      )}
    </>
  );
};

export default HomeLinks;
