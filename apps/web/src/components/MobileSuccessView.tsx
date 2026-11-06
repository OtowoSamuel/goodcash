import React from 'react';
import { formatNaira } from '../lib/rate';

interface MobileSuccessViewProps {
  nairaEstimate: number | null;
  onClose: () => void;
  onViewTransaction: () => void;
}

export const MobileSuccessView: React.FC<MobileSuccessViewProps> = ({
  nairaEstimate,
  onClose,
  onViewTransaction,
}) => {
  const nairaStr = nairaEstimate != null ? formatNaira(nairaEstimate) : '₦ -';

  return (
    <div className="gc fixed inset-0 z-50 flex flex-col overflow-hidden md:hidden">
      <div
        className="gc-col"
        style={{ padding: '14px 14px 0', gap: '10px', flex: 1 }}
      >
        {/* Success hero */}
        <div className="gc-hero">
          <div className="absolute left-1/2 top-0 w-[138px] -translate-x-1/2">
            <i className="gc-c1" style={{ width: '62px', height: '62px', left: '38px', top: '60px' }} />
            <i className="gc-c1" style={{ width: '40px', height: '40px', left: '98px', top: '112px' }} />
            <i className="gc-c1" style={{ width: '28px', height: '28px', left: '0px', top: '116px' }} />
          </div>
        </div>

        {/* Success card, overlapping the hero by 6px */}
        <div className="gc-card" style={{ textAlign: 'center', marginTop: '-6px' }}>
          <div className="gc-ok">✓</div>
          <div className="gc-lab">Cash out complete</div>
          <div className="gc-big gc-big--success">{nairaStr}</div>
          <div className="gc-sm">paid to your bank</div>
        </div>

        <div className="gc-sp" />

        <button onClick={onClose} className="gc-btn gc-hit">
          Close
        </button>
        <button
          onClick={onViewTransaction}
          className="gc-btn gc-btn--white gc-hit"
          style={{ marginBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}
        >
          View transaction
        </button>
      </div>
    </div>
  );
};

export default MobileSuccessView;
