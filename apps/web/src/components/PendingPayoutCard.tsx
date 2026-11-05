import React, { useState } from 'react';
import type { Language } from '../lib/i18n';
import { useBankAccountVerification } from '../lib/useOffRamp';

interface PendingPayoutCardProps {
  txHash: string;
  usdtReceived: number;
  onRetry: (bankCode: string, bankName: string, accountNumber: string, accountHolderName: string) => Promise<void>;
  errorMessage?: string | null;
  language: Language;
}

export const PendingPayoutCard: React.FC<PendingPayoutCardProps> = ({
  txHash,
  usdtReceived,
  onRetry,
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
    <div className="panel-card w-full rounded-[28px] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#A39BBE]">Swap confirmed</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Finish your payout</h2>
        </div>
        <span className="rounded-full border border-[#10B981]/40 bg-[#10B981]/10 px-2.5 py-1 text-[11px] font-medium text-[#6EE7B7]">
          {usdtReceived.toFixed(6)} USDT
        </span>
      </div>

      <p className="mt-3 text-sm text-[#A39BBE]">
        Your G$ was already swapped. Re-enter your bank details to create the payout order. These details are used
        for this request only and are never stored.
      </p>

      <div className="mt-4 rounded-2xl border border-[#2D204A] bg-[#120D1D] p-4">
        <div className="flex items-center justify-between gap-3 border-b border-[#2D204A] pb-3 text-sm text-[#E5E7EB]">
          <span>Bank</span>
          <select
            aria-label="Bank"
            value={institutionCode}
            onChange={(e) => setInstitutionCode(e.target.value)}
            disabled={institutionsLoading}
            className="rounded-xl border border-[#2D204A] bg-[#1B122E] px-3 py-2 text-sm text-[#E5E7EB] outline-none"
          >
            <option value="">{institutionsLoading ? 'Loading banks…' : 'Select bank'}</option>
            {institutions.map((bank) => (
              <option key={bank.code} value={bank.code}>{bank.name}</option>
            ))}
          </select>
        </div>

        <div className="mt-3 space-y-2">
          <label className="block text-[11px] uppercase tracking-[0.12em] text-[#A39BBE]">Account number</label>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Account number"
            value={accountIdentifier}
            onChange={(e) => setAccountIdentifier(e.target.value)}
            placeholder="Enter 10 digits"
            className="w-full rounded-xl border border-[#2D204A] bg-[#1B122E] px-3 py-3 text-base text-white outline-none placeholder:text-[#A39BBE]"
          />
        </div>

        <div className="mt-3 space-y-2">
          <label className="block text-[11px] uppercase tracking-[0.12em] text-[#A39BBE]">Account name</label>
          <div
            aria-live="polite"
            className="min-h-[48px] rounded-xl border border-[#2D204A] bg-[#1B122E] px-3 py-3 text-base text-white"
          >
            {verificationStatus === 'loading' && <span className="text-[#A39BBE]">Verifying with Paycrest…</span>}
            {verificationStatus === 'idle' && <span className="text-[#A39BBE]">Enter a 10-digit account number</span>}
            {verificationStatus === 'error' && <span className="text-[#FCA5A5]">{verificationError}</span>}
            {verificationStatus === 'verified' && accountName && <span className="font-semibold">{accountName}</span>}
          </div>
          {verificationStatus === 'verified' && accountName && (
            <label className="flex items-start gap-2 text-xs text-[#D9D0F4]">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#7C3AED]"
              />
              I confirm this is my account name
            </label>
          )}
          {institutionsError && <p className="text-xs text-[#FCA5A5]">{institutionsError}</p>}
        </div>
      </div>

      {errorMessage && (
        <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
          <span className="font-semibold text-red-100">Payout failed: </span>
          {errorMessage}
        </div>
      )}

      <p className="mt-3 break-all text-[11px] text-[#A39BBE]">Swap tx: {txHash}</p>

      <button
        type="button"
        onClick={handleRetry}
        disabled={!canRetry || isRetrying}
        className={`mt-4 w-full rounded-2xl px-4 py-3.5 text-base font-semibold transition ${
          canRetry && !isRetrying
            ? 'bg-[#7C3AED] text-white shadow-[0_20px_34px_rgba(124,58,237,0.22)] hover:bg-[#8B5CF6]'
            : 'cursor-not-allowed border border-[#2D204A] bg-[#1B122E] text-[#A39BBE]'
        }`}
      >
        {isRetrying ? 'Retrying payout…' : 'Retry payout'}
      </button>
    </div>
  );
};
