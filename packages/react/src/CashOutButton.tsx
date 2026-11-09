import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CashOutFlow, type CashOutFlowProps } from './CashOutFlow';
import { injectStyles } from './styles';

export interface CashOutButtonProps extends Omit<CashOutFlowProps, 'onClose' | 'titleId'> {
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** A button that opens the whole cash-out flow in an accessible dialog. */
export function CashOutButton({ label = 'Cash out to bank', className, style, onEvent, ...flow }: CashOutButtonProps) {
  injectStyles();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    onEvent?.({ type: 'closed' });
    setTimeout(() => opener.current?.focus(), 0);
  }, [onEvent]);

  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  return (
    <>
      <button ref={opener} type="button" className={className ?? 'gcw-btn'} style={style} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {label}
      </button>
      {open && (
        <div className="gcw-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div ref={panel} className="gcw-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <CashOutFlow {...flow} onEvent={onEvent} onClose={close} titleId={titleId} />
          </div>
        </div>
      )}
    </>
  );
}
