import type { AddAsset, OnrampOrder } from './addGs';

/** The Add G$ order this device is in the middle of, so it survives closing the pop-up or reloading. */
export const ADDGS_SAVED_KEY = 'goodcash_addg_order';

export interface SavedAddGs {
  /** G$ or CELO; older saved orders have none and mean G$ */
  asset?: AddAsset;
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

interface HistoryRowLike {
  kind?: string;
  orderId?: string;
  onrampStage?: string;
  arrived?: boolean;
  timestamp: number;
  asset?: AddAsset;
  nairaIn?: number;
}

/**
 * A paid Naira order whose last step ("Get my G$") never ran, found in History. Used to bring that step back on a
 * device that did not start the order. Only recent orders; the newest first.
 */
export function findStuckOnramp<T extends HistoryRowLike>(history: T[], now: number = Date.now()): T | undefined {
  return history
    .filter((h) => h.kind === 'onramp' && !!h.orderId && h.onrampStage === 'done' && !h.arrived && now - h.timestamp < 14 * 86_400_000)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
}

/** The saved record that makes the app show the "Get my G$" step for that order. */
export function savedFromStuckOnramp(row: HistoryRowLike, wallet: string): SavedAddGs {
  return {
    order: {
      orderId: row.orderId as string,
      status: 'settled',
      bank: { institution: '', accountIdentifier: '', accountName: '' },
      amountToTransfer: String(row.nairaIn ?? 0),
      validUntil: '',
    },
    wallet,
    asset: row.asset ?? 'g',
    sent: true,
  };
}
