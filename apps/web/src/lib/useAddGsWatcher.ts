import { useEffect, useRef, useState } from 'react';
import { startPolling } from './polling';
import { fetchOnrampStatus, fetchSwapStatus, reportOnrampArrived, returnToCelo } from './addGs';
import { loadSavedAddGs, saveAddGs } from './addGsSaved';

/**
 * Where this device's Add G$ order is, whether or not the pop-up is open.
 *  waiting  - bank details given, naira not seen yet
 *  received - naira arrived at the partner, dollars on the way
 *  ready    - dollars are in the wallet: the customer must tap "Get my G$"
 *  working  - the swap to G$ is running
 *  problem  - the order ran out of time or is being refunded
 */
export type AddGsPhase = 'waiting' | 'received' | 'ready' | 'working' | 'problem';

interface Options {
  wallet: string | null;
  /** The pop-up has its own live view, so the watcher stays quiet while it is open */
  popupOpen: boolean;
  /** The naira arrived and the customer now needs to tap "Get my G$" (called once per order) */
  onReady: () => void;
  /** The G$ is in the wallet */
  onArrived: () => void;
  intervalMs?: number;
}

export function useAddGsWatcher({ wallet, popupOpen, onReady, onArrived, intervalMs = 8000 }: Options): AddGsPhase | null {
  const [phase, setPhase] = useState<AddGsPhase | null>(null);
  const cb = useRef({ onReady, onArrived });
  cb.current = { onReady, onArrived };

  useEffect(() => {
    if (!wallet) {
      setPhase(null);
      return;
    }
    let alive = true;
    const tick = async () => {
      const s = loadSavedAddGs(wallet);
      if (!s) {
        if (alive) setPhase(null);
        return;
      }
      if (popupOpen) return; // the pop-up is looking after it
      try {
        if (s.swapRequestId) {
          const st = await fetchSwapStatus(s.swapRequestId);
          if (!alive) return;
          if (st === 'success') {
            void reportOnrampArrived(s.order.orderId, s.swapRequestId).catch(() => undefined);
            saveAddGs(null);
            setPhase(null);
            await returnToCelo();
            cb.current.onArrived();
          } else if (st === 'failure' || st === 'refund') {
            setPhase('ready'); // the money is still in the wallet: let them try the last step again
          } else {
            setPhase('working');
          }
          return;
        }
        const o = await fetchOnrampStatus(s.order.orderId);
        if (!alive) return;
        if (o.stage === 'done') {
          setPhase('ready');
          if (!s.readyNotified) {
            saveAddGs({ ...s, readyNotified: true });
            cb.current.onReady();
          }
        } else if (o.stage === 'received' || o.stage === 'review') setPhase('received');
        else if (o.stage === 'expired' || o.stage === 'refund') setPhase('problem');
        else setPhase('waiting');
      } catch {
        // try again at the next check
      }
    };
    const stop = startPolling(tick, { base: intervalMs });
    return () => {
      alive = false;
      stop();
    };
  }, [wallet, popupOpen, intervalMs]);

  return phase;
}
