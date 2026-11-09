/** Everything the widget is told comes in the address. Nothing here is secret (publishable keys are public). */
export type WidgetMode = 'popup' | 'embed' | 'redirect';

export interface WidgetParams {
  key: string;
  mode: WidgetMode;
  /** The partner page that opened us (popup/embed), used as the only postMessage target */
  hostOrigin: string | null;
  /** What the customer wants to do: cash out G$ (default), or add G$/CELO with naira */
  flow: 'cashout' | 'topup';
  amountG?: string;
  /** Top-up: naira the customer wants to add, and which asset */
  amountNaira?: string;
  asset?: 'g' | 'celo';
  partnerRef?: string;
  returnUrl?: string;
  /** The host signs (games with embedded wallets): we ask it over postMessage */
  wallet?: `0x${string}`;
  bridge: boolean;
  appId?: string;
  accent?: string;
  theme?: 'light' | 'dark' | 'auto';
}

export function readParams(search: string): WidgetParams | { error: string } {
  const q = new URLSearchParams(search);
  const key = q.get('key') ?? '';
  if (!/^gc_pk_(live|test)_[A-Za-z0-9]{24,64}$/.test(key)) return { error: 'missing_key' };
  const mode = (['popup', 'embed', 'redirect'].includes(q.get('mode') ?? '') ? q.get('mode') : 'popup') as WidgetMode;
  let hostOrigin: string | null = null;
  const o = q.get('origin');
  if (o) {
    try {
      hostOrigin = new URL(o).origin;
    } catch {
      return { error: 'bad_origin' };
    }
  }
  const amountG = q.get('amountG') ?? undefined;
  const amountNaira = q.get('amountNaira') ?? undefined;
  const wallet = q.get('wallet');
  const accent = q.get('accent');
  const theme = q.get('theme');
  return {
    key,
    mode,
    hostOrigin,
    flow: q.get('flow') === 'topup' ? 'topup' : 'cashout',
    amountNaira: amountNaira && /^\d{1,9}$/.test(amountNaira) ? amountNaira : undefined,
    asset: q.get('asset') === 'celo' ? 'celo' : q.get('asset') === 'g' ? 'g' : undefined,
    amountG: amountG && /^\d+(\.\d{1,6})?$/.test(amountG) ? amountG : undefined,
    partnerRef: q.get('ref') && /^[A-Za-z0-9_.:-]{1,64}$/.test(q.get('ref')!) ? q.get('ref')! : undefined,
    returnUrl: q.get('returnUrl') ?? undefined,
    wallet: wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? (wallet as `0x${string}`) : undefined,
    bridge: q.get('bridge') === '1',
    appId: q.get('app') ?? undefined,
    accent: accent && /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : undefined,
    theme: theme === 'dark' || theme === 'light' || theme === 'auto' ? theme : undefined,
  };
}

/**
 * Where the widget may be shown and whom it may talk to: only the partner's allowed sites. For an embedded frame,
 * the real parent page must match the claimed host origin (the browser tells us; the page cannot fake it).
 */
export function checkHost(p: WidgetParams, allowedOrigins: string[], env: { ancestorOrigin: string | null; referrerOrigin: string | null; framed: boolean }): string | null {
  if (p.mode === 'redirect') {
    if (!p.returnUrl) return 'redirect needs returnUrl';
    let ret: URL;
    try {
      ret = new URL(p.returnUrl);
    } catch {
      return 'bad returnUrl';
    }
    const web = /^https?:$/.test(ret.protocol);
    // An app's own link (mygame://cashout). Never javascript:, data: or other schemes that run or show content here.
    const appLink = !web && /^[a-z][a-z0-9+.-]*:\/\//i.test(p.returnUrl) && !/^(javascript|data|vbscript|blob|file|about|filesystem|intent|chrome|view-source):/i.test(p.returnUrl);
    if (web ? !allowedOrigins.includes(ret.origin) : !appLink) return 'returnUrl is not on the allowed list';
    return null;
  }
  if (!p.hostOrigin) return 'missing origin';
  if (!allowedOrigins.includes(p.hostOrigin)) return 'this site is not on the allowed list';
  if (p.mode === 'embed') {
    if (!env.framed) return 'embed mode must run inside a frame';
    const actual = env.ancestorOrigin ?? env.referrerOrigin;
    if (!actual || actual !== p.hostOrigin) return 'the page around this frame is not the allowed site';
  }
  return null;
}
