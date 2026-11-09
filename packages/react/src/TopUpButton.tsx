import React, { useState } from 'react';
import { useGoodCash } from './context';
import { injectStyles } from './styles';

export type TopUpEvent =
  | { type: 'topup.created' | 'topup.paid_in' | 'topup.delivered' | 'topup.failed'; topUp: { id: string; status: string; amountNaira: number; asset: 'g' | 'celo'; partnerRef: string | null } }
  | { type: 'closed' }
  | { type: 'error'; code?: string; message: string };

export interface TopUpButtonProps {
  label?: string;
  /** Starting amount in naira (the customer can change it) */
  amountNaira?: number;
  asset?: 'g' | 'celo';
  /** Your own id for this customer or order; it comes back in every event and webhook */
  partnerRef?: string;
  /** 'popup' (default) opens a window; 'embed' shows a panel over your page */
  mode?: 'popup' | 'embed';
  onEvent?: (e: TopUpEvent) => void;
  /** Where the widget script lives (default https://pay.goodcash.xyz/widget.js) */
  widgetUrl?: string;
  className?: string;
  style?: React.CSSProperties;
}

interface GoodCashGlobal {
  open: (o: Record<string, unknown>) => { close: () => void };
}
const w = () => (typeof window !== 'undefined' ? (window as unknown as { GoodCash?: GoodCashGlobal }) : {});

function loadWidget(url: string): Promise<GoodCashGlobal> {
  if (w().GoodCash?.open) return Promise.resolve(w().GoodCash as GoodCashGlobal);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => (w().GoodCash?.open ? resolve(w().GoodCash as GoodCashGlobal) : reject(new Error('The GoodCash window could not load.')));
    s.onerror = () => reject(new Error("We couldn't load the GoodCash window. Please check your connection and try again."));
    document.head.appendChild(s);
  });
}

/**
 * A button that lets a customer add G$ or CELO with naira. It opens GoodCash's own page (the hosted widget): the
 * customer's ID details are typed there, never in your app, and never reach your page or your servers.
 */
export function TopUpButton({ label = 'Add G$ with naira', amountNaira, asset, partnerRef, mode = 'popup', onEvent, widgetUrl = 'https://pay.goodcash.xyz/widget.js', className, style }: TopUpButtonProps) {
  injectStyles();
  const { publishableKey, theme } = useGoodCash();
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const gc = await loadWidget(widgetUrl);
      gc.open({ publishableKey, flow: 'topup', mode, amountNaira, asset, partnerRef, theme, onEvent: (e: TopUpEvent) => onEvent?.(e) });
    } catch (e) {
      onEvent?.({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={className ?? 'gcw-btn'} style={style} disabled={busy} onClick={open}>
      {label}
    </button>
  );
}
