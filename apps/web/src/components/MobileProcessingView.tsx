import React from 'react';
import { formatNaira } from '../lib/rate';

interface MobileProcessingViewProps {
  amountG?: number | null;
  nairaEstimate?: number | null;
  usdtEstimate?: number | null;
  txHash?: string;
  onClose: () => void;
  onBackToHome: () => void;
}

export const MobileProcessingView: React.FC<MobileProcessingViewProps> = ({
  amountG = null,
  nairaEstimate = null,
  usdtEstimate = null,
  txHash,
  onClose,
  onBackToHome,
}) => {
  const amountStr = amountG != null && amountG > 0 ? `${amountG.toLocaleString()} G$` : '— G$';
  const nairaStr = nairaEstimate != null ? formatNaira(nairaEstimate) : '₦ -';
  const usdtStr = usdtEstimate != null ? `$${usdtEstimate.toFixed(2)}` : '—';
  const shortHash = txHash && txHash.length > 12 ? `${txHash.slice(0, 6)}…${txHash.slice(-4)}` : txHash;

  return (
    <div className="gc fixed inset-0 z-40 flex flex-col overflow-y-auto">
      <div className="gc-col" style={{ padding: '14px 14px 96px', gap: '10px' }}>
        {/* Header */}
        <header className="gc-top">
          <button
            onClick={onClose}
            aria-label="Close"
            className="gc-back"
          >
            ✕
          </button>
        </header>

        <div>
          <div className="gc-title gc-title--status">On its way</div>
          <p className="gc-sm" style={{ color: 'var(--gc-mute)', margin: '2px 0 0' }}>
            We&rsquo;ll update this page as each step finishes.
          </p>
        </div>

        {/* Vertical Stepper Card */}
        <div className="gc-card">
          {/* Step 1: G$ converted */}
          <div className="gc-tl">
            <div className="gc-tl__col">
              <i className="gc-dot gc-dot--done" />
              <i className="gc-ln" />
            </div>
            <div className="gc-tl__step">
              <b>G$ converted</b>
              <p>Done · {amountStr} → {usdtStr}</p>
            </div>
          </div>

          {/* Step 2: Sent to payout partner */}
          <div className="gc-tl">
            <div className="gc-tl__col">
              <i className="gc-dot gc-dot--current" />
              <i className="gc-ln gc-ln--wait" />
            </div>
            <div className="gc-tl__step">
              <b>Sent to payout partner</b>
              <p>In progress</p>
            </div>
          </div>

          {/* Step 3: Naira in your bank */}
          <div className="gc-tl">
            <div className="gc-tl__col">
              <i className="gc-dot" />
            </div>
            <div className="gc-tl__step">
              <b>Naira in your bank</b>
              <p style={{ margin: 0 }}>Waiting</p>
            </div>
          </div>
        </div>

        {/* Transaction Details Card */}
        <div className="gc-card gc-cost">
          <div className="gc-lab" style={{ marginBottom: '2px' }}>
            Details
          </div>
          <div className="gc-row">
            <span>You gave</span>
            <span>{amountStr}</span>
          </div>
          <div className="gc-row">
            <span>You get about</span>
            <span>{nairaStr}</span>
          </div>
          <div className="gc-row">
            <span>Receipt</span>
            <span className="gc-inter">{shortHash ? `${shortHash} ↗` : '—'}</span>
          </div>
        </div>
      </div>

      {/* Fixed Bottom Action */}
      <div
        className="fixed left-0 right-0 bottom-0 z-50 px-[14px] pb-[14px]"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}
      >
        <button
          onClick={onBackToHome}
          className="gc-btn gc-btn--white gc-hit"
        >
          Back to home
        </button>
      </div>
    </div>
  );
};

export default MobileProcessingView;
