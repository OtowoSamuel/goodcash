/** Look and feel. The default is GoodCash's own sticker-pop style; every colour can be changed. */
export interface GoodCashTheme {
  /** Page/panel background */
  background?: string;
  /** Cards and inputs */
  surface?: string;
  /** Text and borders */
  ink?: string;
  /** Main buttons */
  accent?: string;
  /** Text on main buttons */
  accentInk?: string;
  /** Highlights (amount chips) */
  highlight?: string;
  /** Success */
  success?: string;
  /** Corner radius in px */
  radius?: number;
  /** CSS font-family. Defaults to the app's system font stack (no web fonts are loaded for you). */
  font?: string;
  /** 'auto' follows the device setting */
  mode?: 'light' | 'dark' | 'auto';
}

export const LIGHT: Required<Omit<GoodCashTheme, 'mode'>> = {
  background: '#cdb8ff',
  surface: '#ffffff',
  ink: '#111111',
  accent: '#7b39fc',
  accentInk: '#ffffff',
  highlight: '#ffd23f',
  success: '#8cf0c0',
  radius: 18,
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, Arial, sans-serif',
};

export const DARK: Partial<GoodCashTheme> = {
  background: '#1c1533',
  surface: '#2a2246',
  ink: '#f5f1ff',
  accent: '#9b6bff',
  accentInk: '#ffffff',
  highlight: '#ffd23f',
  success: '#5fd6a0',
};

export function themeVars(t: GoodCashTheme = {}, dark = false): Record<string, string> {
  const base = { ...LIGHT, ...(dark ? DARK : {}), ...stripUndefined(t) };
  return {
    '--gcw-bg': base.background,
    '--gcw-surface': base.surface,
    '--gcw-ink': base.ink,
    '--gcw-accent': base.accent,
    '--gcw-accent-ink': base.accentInk,
    '--gcw-highlight': base.highlight,
    '--gcw-success': base.success,
    '--gcw-radius': `${base.radius}px`,
    '--gcw-font': base.font,
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== undefined && k !== 'mode')) as Partial<T>;
}
