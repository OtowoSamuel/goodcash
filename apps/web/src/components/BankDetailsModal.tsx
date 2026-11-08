import { BankPicker } from './BankPicker';
import React from 'react';
import { useBankAccountVerification } from '../lib/useOffRamp';
import { Modal } from './Modal';

export interface SavedBank {
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

interface BankDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (bank: SavedBank) => void;
}

const SELECT_BG =
  "bg-no-repeat bg-[length:12px_8px] bg-[position:calc(100%_-_1.25rem)_center] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZ2h0PSI4IiB2aWV3Qm94PSIwIDAgMTIgOCI+PHBhdGggZD0iTTEgMWw1IDUgNS01IiBmaWxsPSJub25lIiBzdHJva2U9IiMxMTExMTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+')]";

/**
 * Mobile bank sheet. Uses the same Paycrest institution list and account-name
 * verification as the desktop card, and requires the user to confirm the name.
 */
export const BankDetailsModal: React.FC<BankDetailsModalProps> = ({ isOpen, onClose, onSave }) => {
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

  if (!isOpen) return null;

  const canSave =
    verificationStatus === 'verified' &&
    Boolean(accountName) &&
    confirmed &&
    /^\d{10}$/.test(accountIdentifier) &&
    institutionCode.length > 0;

  const handleSave = () => {
    if (!canSave || !accountName) return;
    onSave({
      bankName: selectedInstitution?.name ?? institutionCode,
      bankCode: institutionCode,
      accountNumber: accountIdentifier,
      accountName,
    });
    onClose();
  };

  return (
    <Modal
      label="Bank details"
      title="Bank details"
      closeLabel="Close modal"
      onClose={onClose}
      z={80}
      tone="white"
      footer={
        <>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={`gc-btn gc-hit ${canSave ? '' : 'gc-btn--dis'}`}
            style={{ height: 46, width: 'auto', flex: '1 1 0', minWidth: 0 }}
          >
            Save details
          </button>
          <button type="button" onClick={onClose} className="gc-btn gc-btn--white gc-hit" style={{ height: 46, width: 'auto', flex: '1 1 0', minWidth: 0 }}>
            Cancel
          </button>
        </>
      }
    >
      <div>
      <div className="gc-lab block mb-1.5">Bank</div>
      <div style={{ flex: '1 1 0', minWidth: 0 }}>
        <BankPicker banks={institutions} loading={institutionsLoading} value={institutionCode} onChange={setInstitutionCode} label="Bank" z={95} />
      </div>
      {institutionsError && <p className="gc-sm mt-1" style={{ color: '#b00020' }}>{institutionsError}</p>}

      <label className="gc-lab block mt-4 mb-1.5" htmlFor="sheet-account">Account number</label>
      <input
        id="sheet-account"
        type="text"
        inputMode="numeric"
        maxLength={10}
        value={accountIdentifier}
        onChange={(e) => setAccountIdentifier(e.target.value.replace(/\D/g, ''))}
        placeholder="10-digit account number"
        className="w-full rounded-xl border-[2.5px] border-[#111] bg-white px-4 py-3 text-base font-bold text-[#111] outline-none"
      />

      <div className="gc-note mt-3" style={{ background: verificationStatus === 'verified' ? '#8cf0c0' : '#fff' }}>
        {verificationStatus === 'loading' && 'Checking your account…'}
        {verificationStatus === 'idle' && 'Enter a 10-digit account number'}
        {verificationStatus === 'error' && (verificationError || 'Could not verify this account')}
        {verificationStatus === 'verified' && accountName && (
          <>
            <div className="gc-lab">Account name</div>
            <b>{accountName}</b>
          </>
        )}
      </div>

      {verificationStatus === 'verified' && accountName && (
        <label className="gc-sm" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I confirm this is my account name
        </label>
      )}
      </div>
    </Modal>
  );
};
