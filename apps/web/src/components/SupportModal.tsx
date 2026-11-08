import React, { useState } from 'react';
import { Modal } from './Modal';
import {
  SUPPORT_TOPICS,
  submitSupport,
  validateSupport,
  type SupportContext,
  type SupportTopic,
} from '../lib/support';

interface SupportModalProps {
  context: SupportContext;
  /** Pre-selects the most likely topic (for example "not arrived" on a delayed payout). */
  defaultTopic?: SupportTopic;
  onClose: () => void;
}

const EMAIL_KEY = 'goodcash_support_email';

function remembered(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Help form: the customer says what happened and where to reply; the cash out details attach themselves. */
export const SupportModal: React.FC<SupportModalProps> = ({ context, defaultTopic = 'not_arrived', onClose }) => {
  const [topic, setTopic] = useState<SupportTopic>(defaultTopic);
  const [email, setEmail] = useState(remembered);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);


  const send = async () => {
    const invalid = validateSupport(email, message);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setBusy(true);
    setProblem(null);
    setUnreachable(false);
    try {
      const id = await submitSupport({ email, topic, message, context });
      try {
        localStorage.setItem(EMAIL_KEY, email.trim());
      } catch {
        // optional convenience only
      }
      setTicket(id);
    } catch {
      setUnreachable(true);
      setProblem("We couldn't send your message just now. Please try again, or use the email option below.");
    } finally {
      setBusy(false);
    }
  };

  const attached: [string, string | undefined][] = [
    ['Order reference', context.orderId],
    ['Swap transaction', context.txHash ? `${context.txHash.slice(0, 10)}…${context.txHash.slice(-6)}` : undefined],
    ['Your wallet', context.wallet ? `${context.wallet.slice(0, 6)}…${context.wallet.slice(-4)}` : undefined],
    ['Status shown', context.status],
    ['Amount', context.amountG ? `${context.amountG} G$${context.naira ? ` → ${context.naira}` : ''}` : undefined],
  ];

  if (ticket) {
    return (
      <Modal
        label="Contact support"
        title="Message sent"
        closeLabel="Close support"
        onClose={onClose}
        z={70}
        footer={<button type="button" onClick={onClose} className="gc-btn gc-hit">Done</button>}
      >
        <div className="gc-card gc-card--mint" style={{ textAlign: 'center' }}>
              <div className="gc-ok">✓</div>
              <div className="gc-lab">Your reference</div>
              <div className="gc-big" style={{ fontSize: 30 }}>{ticket}</div>
              <p className="gc-sm" style={{ margin: '6px 0 0' }}>
                We've got your message and will reply to <b>{email.trim()}</b>. Keep this reference handy.
              </p>
            </div>
      </Modal>
    );
  }

  return (
    <Modal
      label="Contact support"
      title="Contact support"
      closeLabel="Close support"
      onClose={onClose}
      z={70}
      footer={
        <>
          <button type="button" onClick={send} disabled={busy} className={`gc-btn gc-hit ${busy ? 'gc-btn--dis' : ''}`} style={{ height: 46, width: 'auto', flex: '1 1 0', minWidth: 0 }}>
            {busy ? 'Sending…' : 'Send message'}
          </button>
          <button type="button" onClick={onClose} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, width: 'auto', flex: '1 1 0', minWidth: 0 }}>
            Cancel
          </button>
        </>
      }
    >
      <div>
            <div className="gc-lab" style={{ marginBottom: 6 }}>What's the problem?</div>
            <div className="flex flex-wrap gap-2">
              {SUPPORT_TOPICS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTopic(t.id)}
                  aria-pressed={topic === t.id}
                  className={`gc-pill gc-hit ${topic === t.id ? 'gc-pill--on' : 'gc-pill--white'}`}
                  style={{ textAlign: 'left' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="gc-lab" htmlFor="support-email" style={{ display: 'block', marginBottom: 6 }}>Your email (so we can reply)</label>
            <input
              id="support-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border-[2.5px] border-[#111] bg-white px-4 py-3 text-base font-bold text-[#111] outline-none"
            />
          </div>

          <div>
            <label className="gc-lab" htmlFor="support-message" style={{ display: 'block', marginBottom: 6 }}>Tell us what happened</label>
            <textarea
              id="support-message"
              rows={4}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="For example: I confirmed the payment an hour ago and my bank hasn't received anything."
              className="w-full rounded-xl border-[2.5px] border-[#111] bg-white px-4 py-3 text-base font-semibold text-[#111] outline-none"
              style={{ resize: 'vertical', minHeight: 96 }}
            />
          </div>

          <details className="gc-card" style={{ padding: '8px 14px' }}>
            <summary className="gc-sm" style={{ cursor: 'pointer', fontWeight: 800 }}>
              What we'll attach for you
            </summary>
            <div className="gc-cost" style={{ marginTop: 6 }}>
              {attached.filter(([, v]) => v).map(([k, v]) => (
                <div className="gc-row" key={k}><span>{k}</span><span className="font-mono" style={{ fontSize: 12 }}>{v}</span></div>
              ))}
              <p className="gc-sm" style={{ margin: '6px 0 0', fontSize: 11, color: '#444' }}>
                Your bank details are never sent. These details let us find your cash out and check it on the blockchain.
              </p>
            </div>
          </details>

          {problem && <div className="gc-note" role="alert" style={{ background: '#ff9b9b' }}>{problem}</div>}
          {unreachable && (
            <div className="gc-sm" role="status" style={{ textAlign: 'center' }}>
              We couldn't reach support just now. Your message wasn't lost: tap Send again in a minute.
            </div>
          )}
    </Modal>
  );
};

export default SupportModal;
