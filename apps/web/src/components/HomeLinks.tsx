import React, { useState } from 'react';
import { Modal } from './Modal';
import { getTranslations, type Language } from '../lib/i18n';
import { BLOCKSCOUT_URL, SHORT_ROUTER_ADDRESS } from './SafetyBanner';
import { InviteModal } from './InviteModal';
import { VoteModal } from './VoteModal';

type Sheet = 'how' | 'costs' | 'safe';

/**
 * "How it works", "What it costs" and "Stay safe" used to be three cards on the home page. They are answers people
 * look for once, so they now sit behind three small buttons and open in one pop-up.
 */
export const HomeLinks: React.FC<{ language: Language; wallet?: string | null; onAddCelo?: () => void }> = ({ language, wallet, onAddCelo }) => {
  const t = getTranslations(language);
  const [open, setOpen] = useState<Sheet | null>(null);
  const [inviting, setInviting] = useState(false);
  const [voting, setVoting] = useState(false);
  const items: Array<[Sheet, string]> = [
    ['how', t.howItWorks],
    ['costs', t.whatItCostsPanel],
    ['safe', t.staySafe],
  ];
  const label = (s: Sheet) => items.find(([k]) => k === s)![1];

  return (
    <>
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="More about GoodCash">
        {items.map(([k, text]) => (
          <button key={k} type="button" className="gc-pill gc-pill--white gc-hit" onClick={() => setOpen(k)}>
            {text}
          </button>
        ))}
        {wallet && (
          <button type="button" className="gc-pill gc-pill--white gc-hit" onClick={() => setInviting(true)}>
            Invite friends
          </button>
        )}
        {wallet && (
          <button type="button" className="gc-pill gc-pill--white gc-hit" onClick={() => setVoting(true)}>
            Vote for GoodCash
          </button>
        )}
      </div>
      {inviting && wallet && <InviteModal wallet={wallet} onClose={() => setInviting(false)} />}
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
