import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Shared colours (same tokens as the real app). */
export const C = { bg: '#cdb8ff', ink: '#111', pu: '#7b39fc', ye: '#ffd23f', mi: '#8cf0c0', pill: '#ede6ff' };

/** Eases a value from 0 to 1 starting at `at` (frames) over `len` frames. */
export function useProgress(at: number, len = 14): number {
  const f = useCurrentFrame();
  return interpolate(f, [at, at + len], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

/** A springy 0 -> 1 pop-in. */
export function usePop(at: number, damping = 14): number {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - at, fps, config: { damping, stiffness: 140, mass: 0.7 } });
}

/** The phone: a 390 x 800 screen in the app's own look, drawn at 1.15x. */
export const Phone: React.FC<{ children: React.ReactNode; scale?: number }> = ({ children, scale = 1.15 }) => (
  <div
    style={{
      width: 390 * scale + 28,
      height: 800 * scale + 28,
      borderRadius: 52,
      background: '#111',
      padding: 14,
      boxShadow: '14px 14px 0 rgba(17,17,17,0.9)',
      position: 'relative',
    }}
  >
    <div style={{ width: 390 * scale, height: 800 * scale, borderRadius: 40, overflow: 'hidden', position: 'relative', background: C.bg }}>
      <div className="gc" style={{ width: 390, height: 800, transform: `scale(${scale})`, transformOrigin: 'top left', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  </div>
);

/** Layers screens on top of each other and cross-fades between them. */
export const Screen: React.FC<{ from: number; to?: number; children: React.ReactNode; slide?: boolean }> = ({ from, to, children, slide = true }) => {
  const f = useCurrentFrame();
  const inP = interpolate(f, [from, from + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const outP = to === undefined ? 0 : interpolate(f, [to - 8, to], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = inP * (1 - outP);
  if (opacity <= 0.001) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity, transform: slide ? `translateX(${(1 - inP) * 40}px)` : undefined }}>{children}</div>
  );
};

export const WalletChip: React.FC = () => (
  <div className="gc-top" style={{ padding: '16px 16px 0' }}>
    <span className="gc-logo" style={{ color: C.ink }}>GoodCash</span>
    <span className="gc-chip" style={{ color: C.ink }}>0xDeaD…beeF ▾</span>
  </div>
);

export const BottomNav: React.FC<{ active?: 'Home' | 'Cash out' | 'History' }> = ({ active = 'Home' }) => (
  <div className="gc-nav" style={{ position: 'absolute', bottom: 24, left: 16, right: 16 }}>
    {(['Home', 'Cash out', 'History'] as const).map((t) => (
      <span key={t} className={active === t ? 'gc-nav__item gc-nav__item--on' : 'gc-nav__item'}>{t}</span>
    ))}
  </div>
);

export const StepBar: React.FC<{ steps: string[]; at: number }> = ({ steps, at }) => (
  <div style={{ display: 'flex', gap: 6 }}>
    {steps.map((label, i) => (
      <div key={label} style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ height: 8, borderRadius: 99, border: '2px solid #111', background: i < at ? C.mi : i === at ? C.pu : '#fff' }} />
        <div className="gc-sm" style={{ marginTop: 3, fontSize: 11, fontWeight: i === at ? 800 : 600 }}>{label}</div>
      </div>
    ))}
  </div>
);

/** Home: balance card, one big action, quiet extras. */
export const HomeScreen: React.FC<{ balance: string; naira: string; percent?: number; cta?: string; pressed?: boolean }> = ({ balance, naira, percent = 100, cta = 'Cash out', pressed }) => (
  <div style={{ position: 'absolute', inset: 0 }}>
    <WalletChip />
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="gc-card">
        <div className="gc-coin">G$</div>
        <div className="gc-lab">YOUR BALANCE</div>
        <div className="gc-big">{balance}</div>
        <div className="gc-sm">about {naira} after fees</div>
        <div className="gc-bar"><div className="gc-bar__fill" style={{ width: `${percent}%` }} /></div>
        <div className="gc-sm">Ready to cash out</div>
        <div className="gc-sticker">{percent}%</div>
      </div>
      <div className="gc-btn" style={{ transform: pressed ? 'translate(3px,3px)' : undefined, boxShadow: pressed ? '1px 1px 0 #111' : undefined }}>{cta}</div>
      <div className="gc-btn gc-btn--white" style={{ height: 52 }}>Add G$ with naira</div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
        {['How it works', 'What it costs', 'Stay safe'].map((t) => (
          <span key={t} className="gc-pill gc-pill--white">{t}</span>
        ))}
      </div>
    </div>
    <BottomNav />
  </div>
);

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export const CashOutScreen: React.FC<{ amount: string; naira: string; usd: string; pressed?: boolean }> = ({ amount, naira, usd, pressed }) => (
  <div style={{ position: 'absolute', inset: 0, padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div className="gc-top" style={{ position: 'relative' }}>
      <span className="gc-back">✕</span>
      <span className="gc-title" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>Cash out</span>
      <span style={{ width: 34 }} />
    </div>
    <StepBar steps={['Amount', 'Review', 'Confirm', 'Done']} at={0} />
    <div className="gc-card">
      <div className="gc-row" style={{ marginBottom: 6 }}>
        <span className="gc-lab">YOU GIVE</span>
        <span className="gc-pill">MAX 50,000</span>
      </div>
      <div className="gc-row">
        <span className="gc-big">{amount || '0'}</span>
        <span className="gc-pill gc-pill--yellow">G$</span>
      </div>
    </div>
    <div className="gc-sm" style={{ textAlign: 'center', fontWeight: 800 }}>Minimum cash out is about 4,700 G$</div>
    <div className="gc-card gc-card--mint">
      <div className="gc-lab">YOU RECEIVE ABOUT</div>
      <div className="gc-row">
        <span className="gc-big">{naira}</span>
        <span className="gc-pill gc-pill--white">NGN</span>
      </div>
      <div className="gc-sm">at least {usd}</div>
    </div>
    <div className="gc-keys" style={{ marginTop: 'auto', marginBottom: 64 }}>
      {KEYS.map((k) => (
        <span key={k} className="gc-keys__key" style={{ minHeight: 40 }}>{k}</span>
      ))}
    </div>
    <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}>
      <div className="gc-btn" style={{ transform: pressed ? 'translate(3px,3px)' : undefined, boxShadow: pressed ? '1px 1px 0 #111' : undefined }}>Review</div>
    </div>
  </div>
);

export const ReviewScreen: React.FC<{ pressed?: boolean; working?: boolean }> = ({ pressed, working }) => (
  <div style={{ position: 'absolute', inset: 0, padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div className="gc-top" style={{ position: 'relative' }}>
      <span className="gc-back">‹</span>
      <span className="gc-title" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>Review</span>
      <span style={{ width: 34 }} />
    </div>
    <StepBar steps={['Amount', 'Review', 'Confirm', 'Done']} at={working ? 2 : 1} />
    <div className="gc-card">
      <div className="gc-lab">YOU GET ABOUT</div>
      <div className="gc-big">₦727</div>
      <div className="gc-sm">for 5,000 G$ · at least $0.57</div>
    </div>
    <div className="gc-card gc-row">
      <div>
        <div className="gc-lab">PAID TO</div>
        <div className="gc-sm">Moniepoint MFB</div>
        <div className="gc-sm" style={{ color: '#333' }}>ADA OBI</div>
      </div>
      <span className="gc-pill gc-pill--white">Edit</span>
    </div>
    <div className="gc-card gc-cost">
      <div className="gc-row"><span>GoodDollar contribution (10%)</span><span className="gc-mark">−500 G$</span></div>
      <div className="gc-row"><span>Network fee (paid in CELO, not G$)</span><span>about ₦18</span></div>
    </div>
    <div className="gc-note">
      <b>You'll confirm once in your wallet.</b> Open your wallet app, tap Confirm, then come back here.
    </div>
    <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}>
      <div className="gc-btn" style={{ transform: pressed ? 'translate(3px,3px)' : undefined, boxShadow: pressed ? '1px 1px 0 #111' : undefined, opacity: working ? 0.85 : 1 }}>
        {working ? 'Working on it…' : 'Confirm cash out'}
      </div>
    </div>
  </div>
);

/** The shared pop-up frame (same as the app's Modal). */
export const ModalFrame: React.FC<{ title: string; children: React.ReactNode; footer?: React.ReactNode; progress: number }> = ({ title, children, footer, progress }) => (
  <div style={{ position: 'absolute', inset: 0, background: `rgba(17,17,17,${0.55 * progress})` }}>
    <div
      style={{
        position: 'absolute', left: 14, right: 14, top: 60, bottom: 110,
        background: '#fff', border: '2.5px solid #111', borderRadius: 24, boxShadow: '5px 5px 0 #111',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transform: `translateY(${(1 - progress) * 40}px) scale(${0.96 + 0.04 * progress})`, opacity: progress,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 14px 6px' }}>
        <div className="gc-title" style={{ fontSize: 20 }}>{title}</div>
        <span className="gc-back">✕</span>
      </div>
      <div style={{ flex: 1, padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>{children}</div>
      {footer && <div style={{ borderTop: '2.5px solid #111', padding: '12px 14px' }}>{footer}</div>}
    </div>
  </div>
);

export const PrimaryBtn: React.FC<{ label: string; pressed?: boolean }> = ({ label, pressed }) => (
  <div className="gc-btn" style={{ height: 46, transform: pressed ? 'translate(3px,3px)' : undefined, boxShadow: pressed ? '1px 1px 0 #111' : undefined }}>{label}</div>
);

/** A finger-tap ripple at (x, y) inside the phone screen, starting at frame `at`. */
export const Tap: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at }) => {
  const f = useCurrentFrame();
  const t = (f - at) / 16;
  if (t < 0 || t > 1) return null;
  const s = interpolate(t, [0, 1], [0.4, 2.2]);
  return (
    <div style={{ position: 'absolute', left: x - 22, top: y - 22, width: 44, height: 44, borderRadius: 99, border: '4px solid #111', background: 'rgba(255,210,63,0.55)', transform: `scale(${s})`, opacity: 1 - t, pointerEvents: 'none', zIndex: 50 }} />
  );
};
