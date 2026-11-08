import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BankPicker, sortAndFilterBanks } from './BankPicker';

const BANKS = [
  { name: 'Zenith Bank', code: 'Z', type: 'bank' },
  { name: 'Abbey Mortgage Bank', code: 'AB', type: 'bank' },
  { name: 'OPay', code: 'O', type: 'bank' },
  { name: 'Guaranty Trust Bank', code: 'G', type: 'bank' },
  { name: 'Lapo Microfinance Bank', code: 'L', type: 'bank' },
];

describe('BankPicker', () => {
  it('puts popular banks first, the rest A-Z, and searches by name', () => {
    const all = sortAndFilterBanks(BANKS, '');
    expect(all.popular.map((b) => b.name)).toEqual(['OPay', 'Guaranty Trust Bank', 'Zenith Bank']);
    expect(all.rest.map((b) => b.name)).toEqual(['Abbey Mortgage Bank', 'Lapo Microfinance Bank']);
    const q = sortAndFilterBanks(BANKS, 'lap');
    expect([...q.popular, ...q.rest].map((b) => b.name)).toEqual(['Lapo Microfinance Bank']);
  });

  it('opens a searchable list and returns the chosen bank code', () => {
    let picked = '';
    render(<BankPicker banks={BANKS} value="" onChange={(c) => (picked = c)} />);
    fireEvent.click(screen.getByLabelText('Bank'));
    fireEvent.change(screen.getByLabelText('Search banks'), { target: { value: 'zen' } });
    expect(screen.queryByRole('button', { name: /OPay/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Zenith Bank/ }));
    expect(picked).toBe('Z');
  });
});
