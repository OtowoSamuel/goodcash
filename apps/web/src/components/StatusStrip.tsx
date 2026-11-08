import React from 'react';

/**
 * The one place a screen tells the customer what needs their attention. It sits in the page (never floats over
 * buttons) and shows a single notice: the most urgent one.
 */
export interface StatusNotice {
  /** Which notice this is; used to keep the order of importance in one place */
  id: 'money-ready' | 'unfinished-cashout' | 'add-order' | 'add-problem' | 'top-up';
  tone: 'good' | 'warn' | 'bad';
  title: string;
  text: string;
  /** When set the whole strip is a button */
  onClick?: () => void;
}

const TONE: Record<StatusNotice['tone'], string> = { good: '#8cf0c0', warn: '#ffd23f', bad: '#ffd6d6' };

/** Most urgent first. */
const ORDER: StatusNotice['id'][] = ['money-ready', 'add-problem', 'unfinished-cashout', 'add-order', 'top-up'];

export function pickNotice(notices: Array<StatusNotice | null | undefined | false>): StatusNotice | null {
  const real = notices.filter((n): n is StatusNotice => !!n);
  real.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  return real[0] ?? null;
}

export const StatusStrip: React.FC<{ notice: StatusNotice | null }> = ({ notice }) => {
  if (!notice) return null;
  const body = (
    <>
      <b>{notice.title}</b> {notice.text}
    </>
  );
  const style: React.CSSProperties = { background: TONE[notice.tone], textAlign: 'left', width: '100%' };
  return notice.onClick ? (
    <button type="button" className="gc-note gc-hit" role="status" onClick={notice.onClick} style={{ ...style, cursor: 'pointer' }}>
      {body}
    </button>
  ) : (
    <div className="gc-note" role="status" style={style}>
      {body}
    </div>
  );
};

export default StatusStrip;
