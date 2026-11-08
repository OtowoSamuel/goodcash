import React, { useEffect } from 'react';

interface ModalProps {
  /** Spoken name of the pop-up for screen readers. */
  label: string;
  title: string;
  onClose: () => void;
  /** Aria label for the ✕ button. */
  closeLabel?: string;
  /** Buttons that stay pinned at the bottom of the pop-up. */
  footer?: React.ReactNode;
  /** Stack order, so a pop-up opened from another sits on top of it. */
  z?: number;
  tone?: 'lilac' | 'white';
  children: React.ReactNode;
}

/**
 * The one pop-up frame used everywhere in GoodCash. It is always centred on screen, dims the page behind it,
 * scrolls only its middle part, and keeps the title and buttons in view. Use this for every pop-up so they
 * look and behave the same on phones and desktops.
 */
export const Modal: React.FC<ModalProps> = ({
  label,
  title,
  onClose,
  closeLabel = 'Close',
  footer,
  z = 60,
  tone = 'lilac',
  children,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="gc fixed inset-0 flex items-center justify-center p-3"
      style={{ background: 'rgba(5, 5, 9, 0.72)', minHeight: 0, zIndex: z }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-3xl border border-[color:var(--gc-line-strong)] shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
        style={{ maxHeight: 'min(88vh, 720px)', background: tone === 'white' ? 'var(--gc-surface-2)' : 'var(--gc-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="gc-title" style={{ fontSize: 20 }}>{title}</div>
          <button type="button" onClick={onClose} aria-label={closeLabel} className="gc-back">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-3" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {children}
        </div>
        {footer && (
          <div
            className="flex gap-2 border-t border-[color:var(--gc-line-strong)] px-4 py-3"
            style={{ background: tone === 'white' ? 'var(--gc-surface-2)' : 'var(--gc-surface)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
