import { useState } from 'react';

interface BankDetailsState {
  bankName: string;
  accountNumber: string;
  accountName: string | null;
}

interface BankDetailsHookReturn {
  bankDetails: BankDetailsState;
  setBankDetails: (bankName: string, accountNumber: string, accountName: string | null) => void;
  clearBankDetails: () => void;
  isValid: boolean;
}

const useBankDetails = (): BankDetailsHookReturn => {
  const [bankDetails, setBankDetailsState] = useState<BankDetailsState>({
    bankName: '',
    accountNumber: '',
    accountName: null,
  });

  const setBankDetails = (bankName: string, accountNumber: string, accountName: string | null) => {
    setBankDetailsState({
      bankName: bankName.trim(),
      accountNumber: accountNumber.trim(),
      accountName: accountName ? accountName.trim() : null,
    });
  };

  const clearBankDetails = () => {
    setBankDetailsState({
      bankName: '',
      accountNumber: '',
      accountName: null,
    });
  };

  const isValid = bankDetails.accountNumber.length === 10 && /^\d+$/.test(bankDetails.accountNumber);

  return {
    bankDetails,
    setBankDetails,
    clearBankDetails,
    isValid,
  };
};

export { useBankDetails, type BankDetailsState };