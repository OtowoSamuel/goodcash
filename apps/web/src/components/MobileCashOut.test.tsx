import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MobileCashOut } from './MobileCashOut';
import { getMinimumCashOutG } from '../lib/rate';

function type(digits: string) {
  for (const d of digits) fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${d}$`) }));
}

describe('MobileCashOut minimum', () => {
  it('tells the customer the minimum up front', () => {
    render(<MobileCashOut balanceG={20000} ngnPerUsdt={1368} onClose={() => {}} onReview={() => {}} />);
    expect(screen.getByText(new RegExp(`Minimum cash out is.*${getMinimumCashOutG().toLocaleString()} G\\$`))).toBeInTheDocument();
  });

  it('blocks an amount below the minimum and explains why', () => {
    const onReview = vi.fn();
    render(<MobileCashOut balanceG={20000} ngnPerUsdt={1368} onClose={() => {}} onReview={onReview} />);
    // starts at the demo default of 1,000 outside production, which is below the minimum
    expect(screen.getByRole('alert')).toHaveTextContent(/Minimum cash out is/i);
    const review = screen.getByRole('button', { name: /^Review$/ });
    expect(review).toBeDisabled();
    fireEvent.click(review);
    expect(onReview).not.toHaveBeenCalled();
  });

  it('allows an amount at or above the minimum', () => {
    const onReview = vi.fn();
    render(<MobileCashOut balanceG={20000} ngnPerUsdt={1368} onClose={() => {}} onReview={onReview} />);
    fireEvent.click(screen.getByRole('button', { name: /backspace|⌫/i }));
    fireEvent.click(screen.getByRole('button', { name: /backspace|⌫/i }));
    fireEvent.click(screen.getByRole('button', { name: /backspace|⌫/i }));
    fireEvent.click(screen.getByRole('button', { name: /backspace|⌫/i }));
    type('6000');
    const review = screen.getByRole('button', { name: /^Review$/ });
    expect(review).not.toBeDisabled();
    fireEvent.click(review);
    expect(onReview).toHaveBeenCalled();
  });
});
