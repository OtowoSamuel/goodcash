import { isPaidOutStatus } from '../lib/useOffRamp';
import React, { useEffect, useState } from 'react';
import { fetchOrderStatus, type OffRampStatus } from '../lib/useOffRamp';
import { fetchOnrampStatus } from '../lib/addGs';
import { formatNaira, ORDERS_API_BASE } from '../lib/rate';
import { SupportModal } from './SupportModal';
import { Modal } from './Modal';

export interface HistoryDetailItem {
  id: string;
  txHash: string;
  timestamp: number;
  amountInG: number;
  orderId?: string;
  bankReference?: string;
  kind?: 'cashout' | 'onramp';
  asset?: 'g' | 'celo';
  nairaIn?: number;
  assetOut?: number;
  onrampStage?: 'waiting' | 'received' | 'done' | 'expired' | 'refund' | 'review';
  arrived?: boolean;
}

type Stage = 'paid' | 'onItsWay' | 'unknown';

interface HistoryDetailModalProps {
  item: HistoryDetailItem;
  naira: number | null;
  /** What we saved on this device. A live lookup can improve on it. */
  savedStage: Stage;
  /** The connected wallet, attached to a support request so the team can verify the swap. */
  wallet?: string | null;
  onClose: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatWhen(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

/** Plain-language status for the details view. Never shows partner or technical wording. */
function describe(live: OffRampStatus | null, stage: Stage): { title: string; text: string; tone: 'mint' | 'yellow' | 'red' | 'white' } {
  if (live === 'refunded' || live === 'refunding') {
    return { title: 'Refunded', text: 'This payout was cancelled and the money was returned to your wallet.', tone: 'red' };
  }
  if (live === 'expired') {
    return { title: 'Not completed', text: 'The payment window closed before the payment arrived. Nothing was taken from you.', tone: 'red' };
  }
  if (isPaidOutStatus(live) || stage === 'paid') {
    return { title: 'Paid', text: 'Your naira has been sent to your bank account.', tone: 'mint' };
  }
  if (live === 'deposited' || live === 'pending' || live === 'fulfilling') {
    return { title: 'On its way', text: 'We have your payment and your bank is being paid now. This usually takes a few minutes.', tone: 'yellow' };
  }
  if (live === 'initiated') {
    return { title: 'Waiting for payment', text: 'Your payment has not been confirmed yet. Open Cash out to finish it.', tone: 'yellow' };
  }
  if (stage === 'onItsWay') {
    return { title: 'On its way', text: 'Your G$ was converted and your payout is being processed.', tone: 'yellow' };
  }
  return { title: 'Checking status', text: 'We are checking this cash out. Tap Refresh in a moment.', tone: 'white' };
}

/** Same status words as a cash out; only the amounts point the other way. */
function describeOnramp(
  stage: NonNullable<HistoryDetailItem['onrampStage']>,
  arrived: boolean,
  what: string
): { title: string; text: string; tone: 'mint' | 'yellow' | 'red' | 'white' } {
  if (stage === 'refund') {
    return { title: 'Refunded', text: 'This order was cancelled and your money is being returned to your account.', tone: 'red' };
  }
  if (stage === 'expired') {
    return { title: 'Not completed', text: 'The payment window closed before the payment arrived. Nothing was taken from you.', tone: 'red' };
  }
  if (arrived) {
    return { title: 'In your wallet', text: `Your ${what} is in your wallet.`, tone: 'mint' };
  }
  if (stage === 'waiting') {
    return { title: 'Waiting for your transfer', text: `We have not seen your bank transfer yet. Open Add ${what} to see the bank details again.`, tone: 'yellow' };
  }
  if (stage === 'review') {
    return { title: 'Under review', text: 'Your payment is being checked by our payment partner. This can take a little longer. Your money is safe.', tone: 'yellow' };
  }
  if (stage === 'done') {
    return {
      title: 'Naira received',
      text: `Your naira arrived. If your ${what} is already in your wallet, you are all set. If not, open Add ${what} and finish it there.`,
      tone: 'yellow',
    };
  }
  return { title: 'On its way', text: `We have your naira and your ${what} is being added to your wallet. This usually takes a few minutes.`, tone: 'yellow' };
}

const Dot: React.FC<{ state: 'done' | 'current' | 'wait'; label: string; sub: string }> = ({ state, label, sub }) => (
  <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
    <i
      className={`gc-dot ${state === 'done' ? 'gc-dot--done' : state === 'current' ? 'gc-dot--current' : ''}`}
      style={{ display: 'inline-block' }}
    />
    <div style={{ font: "800 12px 'Bricolage Grotesque'", marginTop: 4 }}>{label}</div>
    <div className="gc-sm" style={{ fontSize: 11, color: '#444' }}>{sub}</div>
  </div>
);

export const HistoryDetailModal: React.FC<HistoryDetailModalProps> = ({ item, naira, savedStage, wallet, onClose }) => {
  const [supportOpen, setSupportOpen] = useState(false);
  const [live, setLive] = useState<OffRampStatus | null>(null);
  const [onrampStage, setOnrampStage] = useState<NonNullable<HistoryDetailItem['onrampStage']>>(item.onrampStage ?? 'waiting');
  const [arrived, setArrived] = useState(item.arrived === true);
  const [txHash, setTxHash] = useState(item.txHash);
  const [reference, setReference] = useState<string | null>(item.bankReference ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const isOnramp = item.kind === 'onramp';

  const refresh = async () => {
    setLoading(true);
    setFailed(false);
    try {
      if (isOnramp) {
        if (!item.orderId) throw new Error('no order');
        const s = await fetchOnrampStatus(item.orderId);
        setOnrampStage(s.stage);
        if (s.arrived) setArrived(true);
        if (s.txHash) setTxHash(s.txHash);
        return;
      }
      // Prefer the order that actually belongs to this swap: a customer may have retried, which creates new orders
      let status: OffRampStatus | null = null;
      try {
        const res = await fetch(`${ORDERS_API_BASE}/swaps/${item.txHash}`);
        if (res.ok) status = ((await res.json()) as { status?: OffRampStatus }).status ?? null;
      } catch {
        // fall back to this row's own order below
      }
      if (!status && item.orderId) {
        const order = await fetchOrderStatus(item.orderId);
        status = order.status;
        if (order.paymentReference) setReference(order.paymentReference);
      }
      if (status) setLive(status);
      else if (!item.orderId) throw new Error('no order');
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.orderId, item.txHash]);


  const what = item.asset === 'celo' ? 'CELO' : 'G$';
  const info = isOnramp ? describeOnramp(onrampStage, arrived, what) : describe(live, savedStage);
  const paid = isOnramp ? arrived : info.title === 'Paid';
  const failedFinal = info.tone === 'red';
  const step2Done = paid || info.title === 'On its way';
  const bg = { mint: '#8cf0c0', yellow: '#ffd23f', red: '#ff9b9b', white: '#fff' }[info.tone];
  const nairaIn = item.nairaIn ?? naira;
  const assetOutText = item.assetOut != null && Number.isFinite(item.assetOut)
    ? item.asset === 'celo'
      ? `${(Math.floor(item.assetOut * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CELO`
      : `${Math.floor(item.assetOut).toLocaleString('en-US')} G$`
    : what;

  return (
    <>
      <Modal
        label={isOnramp ? `Add ${what} details` : 'Cash out details'}
        title={isOnramp ? `Add ${what} details` : 'Cash out details'}
        closeLabel="Close details"
        onClose={onClose}
        z={60}
        footer={
          <>
            {(item.orderId || item.txHash) && (
              <button type="button" onClick={refresh} disabled={loading} className={`gc-btn gc-hit ${loading ? 'gc-btn--dis' : ''}`} style={{ height: 46, width: 'auto', flex: '1 1 0', minWidth: 0 }}>
                {loading ? 'Checking…' : 'Refresh status'}
              </button>
            )}
            <button type="button" onClick={onClose} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, width: 'auto', flex: '1 1 0', minWidth: 0 }}>Close</button>
          </>
        }
      >
        <div className="gc-card" style={{ background: bg, padding: '10px 14px' }}>
          <div className="gc-lab">{info.title}</div>
          <div className="gc-big" style={{ fontSize: 26 }}>
            {isOnramp
              ? `${nairaIn != null ? formatNaira(nairaIn) : '—'} → ${assetOutText}`
              : `${item.amountInG.toLocaleString()} G$ → ${naira != null ? formatNaira(naira) : '—'}`}
          </div>
          <p className="gc-sm" style={{ margin: '4px 0 0' }}>{info.text}</p>
        </div>

        {!failedFinal && (
          <div className="gc-card" style={{ display: 'flex', gap: 6, padding: '10px 8px' }}>
            {isOnramp ? (
              <>
                <Dot
                  state={onrampStage === 'waiting' ? 'current' : 'done'}
                  label="Naira received"
                  sub={onrampStage === 'waiting' ? 'Waiting' : 'Done'}
                />
                <Dot
                  state={onrampStage === 'done' || arrived ? 'done' : onrampStage === 'received' || onrampStage === 'review' ? 'current' : 'wait'}
                  label={`Adding ${what}`}
                  sub={onrampStage === 'done' || arrived ? 'Done' : onrampStage === 'received' || onrampStage === 'review' ? 'In progress' : 'Waiting'}
                />
                <Dot state={arrived ? 'done' : onrampStage === 'done' ? 'current' : 'wait'} label="In your wallet" sub={arrived ? 'Done' : onrampStage === 'done' ? 'In progress' : 'Waiting'} />
              </>
            ) : (
              <>
                <Dot state="done" label="G$ converted" sub="Done" />
                <Dot state={step2Done ? 'done' : 'current'} label="Payment sent" sub={step2Done ? 'Done' : 'Waiting'} />
                <Dot state={paid ? 'done' : step2Done ? 'current' : 'wait'} label="In your bank" sub={paid ? 'Done' : step2Done ? 'In progress' : 'Waiting'} />
              </>
            )}
          </div>
        )}

        <div className="gc-card gc-cost" style={{ padding: '4px 14px' }}>
          <div className="gc-row"><span>Date</span><span>{formatWhen(item.timestamp)}</span></div>
          {isOnramp ? (
            <>
              <div className="gc-row"><span>You gave</span><span>{nairaIn != null ? formatNaira(nairaIn) : '—'}</span></div>
              <div className="gc-row"><span>{arrived ? 'You received' : 'You get about'}</span><span>{assetOutText}</span></div>
            </>
          ) : (
            <>
              <div className="gc-row"><span>You gave</span><span>{item.amountInG.toLocaleString()} G$</span></div>
              <div className="gc-row"><span>{paid ? 'You received' : 'You get about'}</span><span>{naira != null ? formatNaira(naira) : '—'}</span></div>
            </>
          )}
          {reference && <div className="gc-row"><span>Bank reference</span><span className="font-mono" style={{ fontSize: 12 }}>{reference}</span></div>}
          {item.orderId && <div className="gc-row"><span>Order reference</span><span className="font-mono select-all" style={{ fontSize: 12 }}>{item.orderId.slice(0, 8)}…{item.orderId.slice(-4)}</span></div>}
          {txHash && (
            <div className="gc-row">
              <span>Transaction</span>
              <a href={`https://celo.blockscout.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                View on explorer ↗
              </a>
            </div>
          )}
        </div>

        {failed && !paid && <div className="gc-note" role="alert">We couldn't refresh just now. Please try again in a moment.</div>}

        {!paid && (
          <p className="gc-sm" style={{ margin: 0, textAlign: 'center' }}>
            Something not right?{' '}
            <button type="button" onClick={() => setSupportOpen(true)} style={{ textDecoration: 'underline', fontWeight: 800 }}>
              Contact support
            </button>
          </p>
        )}
      </Modal>

      {supportOpen && (
        <SupportModal
          onClose={() => setSupportOpen(false)}
          defaultTopic={info.title === 'Waiting for payment' ? 'payment_failed' : 'not_arrived'}
          context={{
            orderId: item.orderId,
            txHash: item.txHash,
            wallet: wallet ?? undefined,
            status: info.title,
            amountG: isOnramp ? undefined : item.amountInG.toLocaleString(),
            naira: nairaIn != null ? formatNaira(nairaIn) : undefined,
            createdAt: new Date(item.timestamp).toISOString(),
          }}
        />
      )}
    </>
  );
};

export default HistoryDetailModal;
