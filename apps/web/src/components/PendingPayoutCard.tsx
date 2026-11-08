import React, { useState } from 'react';
import type { Language } from '../lib/i18n';
import { useBankAccountVerification } from '../lib/useOffRamp';

interface PendingPayoutCardProps {
  txHash: string;
  usdtReceived: number;
  onRetry: (bankCode: string, bankName: string, accountNumber: string, accountHolderName: string) => Promise<void>;
  onCancel?: () => void;
  errorMessage?: string | null;
  language: Language;
}

export const PendingPayoutCard: React.FC<PendingPayoutCardProps> = ({
  txHash,
  usdtReceived,
  onRetry,
  onCancel,
  errorMessage,
  language: _language,
}) => {
  const [isRetrying, setIsRetrying] = useState(false);
  const {
    institutions,
    institutionsLoading,
    institutionsError,
    institutionCode,
    setInstitutionCode,
    selectedInstitution,
    accountIdentifier,
    setAccountIdentifier,
    accountName,
    verificationStatus,
    verificationError,
    confirmed,
    setConfirmed,
  } = useBankAccountVerification('NGN');

  const canRetry =
    institutionCode.trim().length > 0 &&
    accountIdentifier.length === 10 &&
    verificationStatus === 'verified' &&
    Boolean(accountName) &&
    confirmed;

  const handleRetry = async () => {
    if (!canRetry || isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetry(institutionCode, selectedInstitution?.name ?? '', accountIdentifier, accountName ?? '');
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="w-full rounded-3xl border border-[color:var(--gc-line-strong)] bg-[color:var(--gc-surface-2)] p-6 shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[color:var(--gc-ink)]">Swap confirmed</p>
          <h2 className="mt-1 text-2xl font-black text-[color:var(--gc-ink)]">Finish your payout</h2>
        </div>
        <span className="rounded-full border border-[color:var(--gc-line-strong)] bg-[color:var(--gc-ok-bg)] px-3 py-1 text-[11px] font-black uppercase text-[color:var(--gc-ink)]">
          ${usdtReceived.toFixed(2)}
        </span>
      </div>

      <p className="mt-3 text-sm font-bold text-[color:var(--gc-ink)]">
        Your G$ was already swapped. Re-enter your bank details to create the payout order. These details are used
        for this request only and are never stored.
      </p>

      <div className="mt-4 rounded-2xl border border-[color:var(--gc-line-strong)] bg-[color:var(--gc-surface-2)] p-4 shadow-none">
        <div className="flex items-center justify-between gap-3 border-b border-solid border-[color:var(--gc-line)] pb-3 text-sm font-bold text-[color:var(--gc-ink)]">
          <span className="flex-none">Bank</span>
          <select
            aria-label="Bank"
            value={institutionCode}
            onChange={(e) => setInstitutionCode(e.target.value)}
            disabled={institutionsLoading}
            className="min-w-0 flex-1 max-w-full rounded-xl border border-[color:var(--gc-line-strong)] bg-[color:var(--gc-surface-2)] pl-3 pr-12 py-2 text-sm font-bold text-[color:var(--gc-ink)] shadow-none outline-none appearance-none bg-no-repeat bg-[length:12px_8px] bg-[position:calc(100%_-_1.25rem)_center] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZ2h0PSI4IiB2aWV3Qm94PSIwIDAgMTIgOCI+PHBhdGggZD0iTTEgMWw1IDUgNS01IiBmaWxsPSJub25lIiBzdHJva2U9IiMxMTExMTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+')]"
          >
            <option value="">{institutionsLoading ? 'Loading banks…' : 'Select bank'}</option>
            {institutions.map((bank) => (
              <option key={bank.code} value={bank.code}>{bank.name}</option>
            ))}
          </select>
        </div>

        <div className="mt-3 space-y-2">
          <label className="block text-[11px] font-black uppercase tracking-[0.12em] text-[color:var(--gc-ink)]">Account number</label>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Account number"
            value={accountIdentifier}
            onChange={(e) => setAccountIdentifier(e.target.value)}
            placeholder="Enter 10 digits"
            className="w-full rounded-xl border border-[color:var(--gc-line-strong)] bg-[color:var(--gc-surface-2)] px-4 py-3 text-base font-bold text-[color:var(--gc-ink)] shadow-none outline-none placeholder:text-[color:var(--gc-faint)]"
          />
        </div>

        <div className="mt-3 space-y-2">
          <label className="block text-[11px] font-black uppercase tracking-[0.12em] text-[color:var(--gc-ink)]">Account name</label>
          <div
            aria-live="polite"
            className="min-h-[48px] rounded-xl border border-[color:var(--gc-line-strong)] bg-[color:var(--gc-surface-2)] px-4 py-3 text-base font-bold text-[color:var(--gc-ink)] shadow-none"
          >
            {verificationStatus === 'loading' && <span className="text-[color:var(--gc-mute)]">Checking your account…</span>}
            {verificationStatus === 'idle' && <span className="text-[color:var(--gc-mute)]">Enter a 10-digit account number</span>}
            {verificationStatus === 'error' && <span className="text-red-600">{verificationError}</span>}
            {verificationStatus === 'verified' && accountName && <span className="font-black">{accountName}</span>}
          </div>
          {verificationStatus === 'verified' && accountName && (
            <label className="flex items-start gap-2 text-xs font-bold text-[color:var(--gc-ink)]">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#7b39fc]"
              />
              I confirm this is my account name
            </label>
          )}
          {institutionsError && <p className="text-xs font-bold text-red-600">{institutionsError}</p>}
        </div>
      </div>

      {errorMessage && (
        <div className="mt-3 rounded-xl border border-[color:var(--gc-line-strong)] bg-[color:var(--gc-danger-bg)] p-3.5 text-xs font-bold text-white shadow-none">
          <span className="font-black">Payout failed: </span>
          {errorMessage}
        </div>
      )}

      <p className="mt-3 break-all text-[11px] font-bold text-[color:var(--gc-mute)]">Swap tx: {txHash}</p>

      <button
        type="button"
        onClick={handleRetry}
        disabled={!canRetry || isRetrying}
        className={`mt-4 w-full rounded-2xl border border-[color:var(--gc-line-strong)] px-4 py-3.5 text-base font-black shadow-none transition ${
          canRetry && !isRetrying
            ? 'bg-[color:var(--gc-pu)] text-white hover:translate-x-[2px] hover:translate-y-[2px] shadow-none'
            : 'cursor-not-allowed bg-[color:var(--gc-surface-3)] text-[color:var(--gc-faint)]'
        }`}
      >
        {isRetrying ? 'Retrying payout…' : 'Retry payout'}
      </button>

      {/* Cancel Button */}
      {onCancel && (
        <button
          onClick={() => {
            if (window.confirm('This clears the reminder. Your funds stay safe in your wallet, and you can finish the payout later with the swap transaction hash. Continue?')) onCancel();
          }}
          type="button"
          className="text-sm font-bold text-[color:var(--gc-mute)] hover:text-[color:var(--gc-ink)] underline block mx-auto mt-4 text-center cursor-pointer"
        >
          Cancel and start new cash out
        </button>
      )}
      {onCancel && (
        <p className="mt-2 text-center text-[11px] font-semibold text-[color:var(--gc-mute)]">
          Cancelling only clears this reminder. Your funds stay safe in your wallet.
        </p>
      )}
    </div>
  );
};
