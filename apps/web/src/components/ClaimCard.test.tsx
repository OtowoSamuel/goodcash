import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClaimCard } from './ClaimCard';

describe('ClaimCard', () => {
  it('renders claim button when verified and not yet claimed', () => {
    render(<ClaimCard isVerified={true} entitlementG={123.48} onClaimSuccess={vi.fn()} language="en" />);

    expect(screen.getByRole('button', { name: /Claim 123 G\$ to Wallet/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Claim 123 G\$ to Wallet/i })).not.toBeDisabled();
  });

  it('renders disabled "Claimed Today" button after claiming', async () => {
    const onClaimSuccess = vi.fn();
    render(<ClaimCard isVerified={true} entitlementG={123.48} onClaimSuccess={onClaimSuccess} language="en" />);

    const claimButton = screen.getByRole('button', { name: /Claim 123 G\$ to Wallet/i });
    fireEvent.click(claimButton);

    // Wait for the 1200ms claiming timeout to complete
    await new Promise((resolve) => setTimeout(resolve, 1300));

    expect(screen.getByRole('button', { name: /✓ Claimed Today/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /✓ Claimed Today/i })).toBeDisabled();
  });

  it('renders disabled "Verify Wallet to Claim" button when not verified', () => {
    render(<ClaimCard isVerified={false} entitlementG={123.48} onClaimSuccess={vi.fn()} language="en" />);

    expect(screen.getByRole('button', { name: /Verify Wallet to Claim/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify Wallet to Claim/i })).toBeDisabled();
  });

  it('shows loading spinner while claiming', async () => {
    const onClaimSuccess = vi.fn();
    render(<ClaimCard isVerified={true} entitlementG={123.48} onClaimSuccess={onClaimSuccess} language="en" />);

    const claimButton = screen.getByRole('button', { name: /Claim 123 G\$ to Wallet/i });
    fireEvent.click(claimButton);

    expect(await screen.findByText(/Claiming G\$ from Celo UBI Scheme\.\.\./i)).toBeInTheDocument();
  });

  it('calls onClaimSuccess when claim button is clicked', async () => {
    const onClaimSuccess = vi.fn();
    render(<ClaimCard isVerified={true} entitlementG={123.48} onClaimSuccess={onClaimSuccess} language="en" />);

    const claimButton = screen.getByRole('button', { name: /Claim 123 G\$ to Wallet/i });
    fireEvent.click(claimButton);

    // onClaimSuccess is called after 1200ms timeout in the component
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(onClaimSuccess).toHaveBeenCalledWith(123.48);
  });

  it('renders verification notice when not verified', () => {
    render(<ClaimCard isVerified={false} entitlementG={123.48} onClaimSuccess={vi.fn()} language="en" />);

    expect(screen.getByText(/GoodDollar Identity Verification Required/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Complete verification at wallet\.gooddollar\.org/i })).toBeInTheDocument();
  });
});
