import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { VerifyGate } from './VerifyGate';

describe('VerifyGate', () => {
  it('sends people to GoodDollar in a new tab, and says why in plain words', () => {
    render(<VerifyGate onClose={() => undefined} onRecheck={async () => 'not_verified'} />);
    const link = screen.getByRole('link', { name: /^Verify with GoodDollar$/ });
    expect(link).toHaveAttribute('href', 'https://wallet.gooddollar.org');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(screen.getByText(/quick, free, and only needs to be done once/i)).toBeInTheDocument();
  });

  it('carries on by itself once the check says verified', async () => {
    const onClose = vi.fn();
    const onVerified = vi.fn();
    render(<VerifyGate onClose={onClose} onVerified={onVerified} onRecheck={async () => 'verified'} />);
    fireEvent.click(screen.getByRole('button', { name: /I've verified, check again/i }));
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says it is not shown yet, without closing', async () => {
    const onClose = vi.fn();
    render(<VerifyGate onClose={onClose} onRecheck={async () => 'not_verified'} />);
    fireEvent.click(screen.getByRole('button', { name: /I've verified, check again/i }));
    expect(await screen.findByText(/does not show this wallet as verified yet/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says so when the check itself fails, and does not claim "not verified"', async () => {
    render(<VerifyGate onClose={() => undefined} onRecheck={async () => 'unknown'} />);
    fireEvent.click(screen.getByRole('button', { name: /I've verified, check again/i }));
    expect(await screen.findByText(/could not check right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/does not show this wallet as verified/i)).toBeNull();
  });
});
