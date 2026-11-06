import React, { useState } from 'react';

interface BankDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (bankName: string, accountNumber: string, accountName: string | null) => void;
  initialBank?: string;
  initialAccountNumber?: string;
}

export const BankDetailsModal: React.FC<BankDetailsModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialBank,
  initialAccountNumber,
}) => {
  const [bankName, setBankName] = useState(initialBank || '');
  const [accountNumber, setAccountNumber] = useState(initialAccountNumber || '');
  const [accountName, setAccountName] = useState<string | null>(null);

  const handleBankChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setBankName(e.target.value);
  };

  const handleAccountNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    setAccountNumber(value);
    if (value.length === 10) {
      // Simulate account name resolution when 10 digits entered
      setAccountName(`Beneficiary for ${bankName}`);
    } else {
      setAccountName(null);
    }
  };

  const handleSave = () => {
    onSave(bankName, accountNumber, accountName);
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
    >
      <div
        className="relative z-[10000] bg-white w-full max-w-md border-4 border-[#111] rounded-3xl p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-black text-[#111]">Bank Details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="bg-white border-2 border-[#111] rounded-xl w-9 h-10 flex items-center justify-center font-bold shadow-[2px_2px_0px_#111]"
          >
            ✕
          </button>
        </div>

        {/* Bank Name Selector */}
        <div className="mb-5">
          <label className="block text-sm font-bold text-[#111] mb-2">
            Bank Name
          </label>
          <select
            value={bankName}
            onChange={handleBankChange}
            className="w-full rounded-xl border-2 border-[#111] bg-white px-4 py-3 text-base font-bold text-[#111] shadow-[2px_2px_0px_#111] outline-none appearance-none"
          >
            <option value="">Select a bank</option>
            <option value="Access Bank">Access Bank</option>
            <option value="GTBank">GTBank</option>
            <option value="Zenith Bank">Zenith Bank</option>
            <option value="First Bank">First Bank</option>
            <option value="UBA">UBA</option>
            <option value="Fidelity Bank">Fidelity Bank</option>
            <option value="Stanbic IBTC">Stanbic IBTC</option>
          </select>
        </div>

        {/* Account Number */}
        <div className="mb-5">
          <label className="block text-sm font-bold text-[#111] mb-2">
            Account Number
          </label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            value={accountNumber}
            onChange={handleAccountNumberChange}
            placeholder="10-digit account number"
            className="w-full rounded-xl border-2 border-[#111] bg-white px-4 py-3 text-base font-bold text-[#111] shadow-[2px_2px_0px_#111] outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {accountName && (
            <div className="mt-2 text-sm text-[#666]">
              {accountName}
            </div>
          )}
        </div>

        {/* Validation state */}
        {!accountName && accountNumber.length > 0 && (
          <div className="mt-2 text-sm text-[#FCA5A5]">
            Please enter a 10-digit account number
          </div>
        )}

        {/* Save Button */}
        <button
          type="button"
          onClick={handleSave}
          disabled={!accountName || accountNumber.length !== 10}
          className="w-full bg-[#7b39fc] text-white border-2 border-[#111] rounded-2xl py-3 text-xl font-bold shadow-[4px_4px_0px_#111] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all disabled:bg-[#8b4aff] disabled:opacity-80 disabled:cursor-not-allowed"
        >
          Save Details
        </button>

        {/* Cancel Button */}
        <button
          type="button"
          onClick={onClose}
          className="w-full mt-4 bg-white text-[#111] border-2 border-[#111] rounded-2xl py-3 text-xl font-bold shadow-[4px_4px_0px_#111] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};