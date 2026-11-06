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
    <div className="w-full rounded-3xl border-4 border-[#111] bg-white p-6 shadow-[8px_8px_0px_#111]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#111]">Swap confirmed</p>
          <h2 className="mt-1 text-2xl font-black text-[#111]">Finish your payout</h2>
        </div>
        <span className="rounded-full border-2 border-[#111] bg-[#63f2b4] px-3 py-1 text-[11px] font-black uppercase text-[#111]">
          {usdtReceived.toFixed(6)} USDT
        </span>
      </div>

      <p className="mt-3 text-sm font-bold text-[#111]">
        Your G$ was already swapped. Re-enter your bank details to create the payout order. These details are used
        for this request only and are never stored.
      </p>

      <div className="mt-4 rounded-2xl border-2 border-[#111] bg-white p-4 shadow-[4px_4px_0px_#111]">
        <div className="flex items-center justify-between gap-3 border-b-2 border-dashed border-gray-300 pb-3 text-sm font-bold text-[#111]">
          <span>Bank</span>
          <select
            aria-label="Bank"
            value={institutionCode}
            onChange={(e) => setInstitutionCode(e.target.value)}
            disabled={institutionsLoading}
            className="rounded-xl border-2 border-[#111] bg-white pl-3 pr-12 py-2 text-sm font-bold text-[#111] shadow-[2px_2px_0px_#111] outline-none appearance-none bg-no-repeat bg-[length:12px_8px] bg-[position:calc(100%_-_1.25rem)_center] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZ2h0PSI4IiB2aWV3Qm94PSIwIDAgMTIgOCI+PHBhdGggZD0iTTEgMWw1IDUgNS01IiBmaWxsPSJub25lIiBzdHJva2U9IiMxMTExMTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+')]"
          >
            <option value="">{institutionsLoading ? 'Loading banks…' : 'Select bank'}</option>
            {institutions.map((bank) => (
              <option key={bank.code} value={bank.code}>{bank.name}</option>
            ))}
          </select>
        </div>

        <div className="mt-3 space-y-2">
          <label className="block text-[11px] font-black uppercase tracking-[0.12em] text-[#111]">Account number</label>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Account number"
            value={accountIdentifier}
            onChange={(e) => setAccountIdentifier(e.target.value)}
            placeholder="Enter 10 digits"
            className="w-full rounded-xl border-2 border-[#111] bg-white px-4 py-3 text-base font-bold text-[#111] shadow-[2px_2px_0px_#111] outline-none placeholder:text-gray-400"
          />
        </div>

        <div className="mt-3 space-y-2">
          <label className="block text-[11px] font-black uppercase tracking-[0.12em] text-[#111]">Account name</label>
          <div
            aria-live="polite"
            className="min-h-[48px] rounded-xl border-2 border-[#111] bg-white px-4 py-3 text-base font-bold text-[#111] shadow-[2px_2px_0px_#111]"
          >
            {verificationStatus === 'loading' && <span className="text-gray-500">Verifying with Paycrest…</span>}
            {verificationStatus === 'idle' && <span className="text-gray-500">Enter a 10-digit account number</span>}
            {verificationStatus === 'error' && <span className="text-red-600">{verificationError}</span>}
            {verificationStatus === 'verified' && accountName && <span className="font-black">{accountName}</span>}
          </div>
          {verificationStatus === 'verified' && accountName && (
            <label className="flex items-start gap-2 text-xs font-bold text-[#111]">
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
        <div className="mt-3 rounded-xl border-2 border-[#111] bg-[#ff6b6b] p-3.5 text-xs font-bold text-white shadow-[3px_3px_0px_#111]">
          <span className="font-black">Payout failed: </span>
          {errorMessage}
        </div>
      )}

      <p className="mt-3 break-all text-[11px] font-bold text-gray-500">Swap tx: {txHash}</p>

      <button
        type="button"
        onClick={handleRetry}
        disabled={!canRetry || isRetrying}
        className={`mt-4 w-full rounded-2xl border-2 border-[#111] px-4 py-3.5 text-base font-black shadow-[4px_4px_0px_#111] transition ${
          canRetry && !isRetrying
            ? 'bg-[#7b39fc] text-white hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#111]'
            : 'cursor-not-allowed bg-gray-200 text-gray-400'
        }`}
      >
        {isRetrying ? 'Retrying payout…' : 'Retry payout'}
      </button>

      {/* Cancel Button */}
      {onCancel && (
        <button
          onClick={onCancel}
          type="button"
          className="text-sm font-bold text-gray-600 hover:text-[#111] underline block mx-auto mt-4 text-center cursor-pointer"
        >
          Cancel and start new cash out
        </button>
      )}
    </div>
  );
};
