import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BankInstitution } from '../lib/useOffRamp';

/**
 * Our own bank chooser (instead of the phone's built-in dropdown): a button that opens a searchable list right
 * underneath it (never a second pop-up on top of the current one), with the banks most people use pinned at the top.
 */

/** Names as the partner's list spells them. Matched case-insensitively; missing ones are simply skipped. */
const POPULAR = [
  'OPay',
  'PalmPay',
  'Moniepoint MFB',
  'Kuda Microfinance Bank',
  'Guaranty Trust Bank',
  'Access Bank',
  'Zenith Bank',
  'First Bank Of Nigeria',
  'United Bank for Africa',
  'Wema Bank',
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Popular banks first (in our order), then the rest A-Z; filtered by the search text. */
export function sortAndFilterBanks(banks: BankInstitution[], query: string): { popular: BankInstitution[]; rest: BankInstitution[] } {
  const q = norm(query);
  const match = (b: BankInstitution) => !q || norm(b.name).includes(q);
  const popularSet = new Map(POPULAR.map((n, i) => [norm(n), i]));
  const popular = banks
    .filter((b) => popularSet.has(norm(b.name)) && match(b))
    .sort((a, b) => popularSet.get(norm(a.name))! - popularSet.get(norm(b.name))!);
  const rest = banks
    .filter((b) => !popularSet.has(norm(b.name)) && match(b))
    .sort((a, b) => a.name.trim().localeCompare(b.name.trim()));
  return { popular, rest };
}

interface Props {
  banks: BankInstitution[];
  loading?: boolean;
  value: string;
  onChange: (code: string) => void;
  /** Spoken label for the button */
  label?: string;
  z?: number;
}

const Row: React.FC<{ bank: BankInstitution; selected: boolean; onPick: () => void }> = ({ bank, selected, onPick }) => (
  <button
    type="button"
    onClick={onPick}
    className="gc-hit"
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      width: '100%',
      textAlign: 'left',
      padding: '10px 12px',
      borderRadius: 14,
      border: '2.5px solid #111',
      background: selected ? '#8cf0c0' : '#fff',
      fontWeight: 700,
      color: '#111',
    }}
  >
    <span
      aria-hidden
      style={{
        width: 32,
        height: 32,
        flex: 'none',
        borderRadius: 10,
        border: '2px solid #111',
        background: '#ede6ff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
      }}
    >
      {bank.name.trim().charAt(0).toUpperCase()}
    </span>
    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bank.name.trim()}</span>
    {selected && <span aria-hidden>✓</span>}
  </button>
);

export const BankPicker: React.FC<Props> = ({ banks, loading = false, value, onChange, label = 'Bank', z = 95 }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = banks.find((b) => b.code === value) ?? null;
  const { popular, rest } = useMemo(() => sortAndFilterBanks(banks, query), [banks, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox" aria-expanded={open}
        disabled={loading}
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border-[2.5px] border-[#111] bg-white px-4 py-3 text-base font-bold text-[#111] outline-none gc-hit"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? '#111' : '#6b6585' }}>
          {loading ? 'Loading banks…' : selected ? selected.name.trim() : 'Choose your bank'}
        </span>
        <span aria-hidden style={{ fontSize: 18 }}>›</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Banks"
          style={{ marginTop: 8, border: '2.5px solid #111', borderRadius: 16, background: '#fff', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search banks"
            aria-label="Search banks"
            className="w-full rounded-xl border-[2.5px] border-[#111] bg-white px-4 py-3 text-base font-bold text-[#111] outline-none"
          />
          <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 2 }}>
            {popular.length > 0 && (
              <>
                <div className="gc-lab">{query ? 'Popular matches' : 'Popular'}</div>
                {popular.map((b) => (
                  <Row key={b.code} bank={b} selected={b.code === value} onPick={() => pick(b.code)} />
                ))}
              </>
            )}
            {rest.length > 0 && (
              <>
                <div className="gc-lab">{query ? 'Other matches' : 'All banks'}</div>
                {rest.map((b) => (
                  <Row key={b.code} bank={b} selected={b.code === value} onPick={() => pick(b.code)} />
                ))}
              </>
            )}
            {popular.length + rest.length === 0 && <div className="gc-note">No bank matches “{query}”. Check the spelling.</div>}
          </div>
        </div>
      )}
    </>
  );
};

export default BankPicker;
