import type { OnrampOrder } from './addGs';

/** The Add G$ order this device is in the middle of, so it survives closing the pop-up or reloading. */
export const ADDGS_SAVED_KEY = 'goodcash_addg_order';

export interface SavedAddGs {
  order: OnrampOrder;
  wallet: string;
  swapRequestId?: string;
  /** The customer asked for emails (kept only so the box is not shown twice) */
  emailed?: boolean;
  /** The customer said they sent the transfer */
  sent?: boolean;
  /** We already told them (on screen) that their money arrived */
  readyNotified?: boolean;
}

export function loadSavedAddGs(wallet: string): SavedAddGs | null {
  try {
    const s = JSON.parse(localStorage.getItem(ADDGS_SAVED_KEY) ?? 'null') as SavedAddGs | null;
    return s && s.wallet.toLowerCase() === wallet.toLowerCase() ? s : null;
  } catch {
    return null;
  }
}

export function saveAddGs(s: SavedAddGs | null): void {
  try {
    if (s) localStorage.setItem(ADDGS_SAVED_KEY, JSON.stringify(s));
    else localStorage.removeItem(ADDGS_SAVED_KEY);
  } catch {
    // private mode: the order simply will not resume after a reload
  }
}
