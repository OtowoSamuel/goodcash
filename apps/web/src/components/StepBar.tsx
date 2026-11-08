import React from 'react';

/** The same "where am I" bar on every multi-step screen (cash out, Add G$). */
export const StepBar: React.FC<{ steps: readonly string[]; at: number }> = ({ steps, at }) => (
  <div style={{ display: 'flex', gap: 6 }} role="img" aria-label={`Step ${at + 1} of ${steps.length}: ${steps[at]}`}>
    {steps.map((label, i) => (
      <div key={label} style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ height: 8, borderRadius: 99, border: '2px solid #111', background: i < at ? '#8cf0c0' : i === at ? '#7b39fc' : '#fff' }} />
        <div className="gc-sm" style={{ marginTop: 3, fontSize: 11, fontWeight: i === at ? 800 : 600 }}>{label}</div>
      </div>
    ))}
  </div>
);

export const CASH_OUT_STEPS = ['Amount', 'Review', 'Confirm', 'Done'] as const;

export default StepBar;
