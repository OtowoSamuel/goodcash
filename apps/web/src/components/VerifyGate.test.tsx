import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { VerifyGate } from './VerifyGate';

const W = '0x1234567890abcdef1234567890abcdef12345678';

describe('VerifyGate', () => {
  it('starts verification with the wallet already connected (no link to log in elsewhere)', async () => {
    const start = vi.fn(async () => undefined);
    render(<VerifyGate wallet={W} intent="add-g" onClose={() => undefined} onRecheck={async () => 'not_verified'} start={start} />);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Verify with GoodDollar$/ }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(W, 'add-g'));
    expect(screen.getByText(/Approve the message in your wallet/)).toBeInTheDocument();
    expect(screen.getByText(/quick, free, and only needs to be done once/i)).toBeInTheDocument();
  });

  it('says so in plain words when the person cancels in their wallet, and lets them try again', async () => {
    const start = vi.fn(async () => { throw new Error('User rejected the request.'); });
    render(<VerifyGate wallet={W} intent="cashout" onClose={() => undefined} onRecheck={async () => 'not_verified'} start={start} />);
    fireEvent.click(screen.getByRole('button', { name: /^Verify with GoodDollar$/ }));
    expect(await screen.findByText(/You cancelled in your wallet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Verify with GoodDollar$/ })).toBeEnabled();
  });

  it('carries on by itself once the check says verified', async () => {
    const onClose = vi.fn();
    const onVerified = vi.fn();
    render(<VerifyGate wallet={W} intent="cashout" onClose={onClose} onVerified={onVerified} onRecheck={async () => 'verified'} />);
    fireEvent.click(screen.getByRole('button', { name: /^I've verified$/i }));
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says it is not shown yet, without closing', async () => {
    const onClose = vi.fn();
    render(<VerifyGate wallet={W} intent="cashout" onClose={onClose} onRecheck={async () => 'not_verified'} />);
    fireEvent.click(screen.getByRole('button', { name: /^I've verified$/i }));
    expect(await screen.findByText(/does not show this wallet as verified yet/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says so when the check itself fails, and does not claim "not verified"', async () => {
    render(<VerifyGate wallet={W} intent="cashout" onClose={() => undefined} onRecheck={async () => 'unknown'} />);
    fireEvent.click(screen.getByRole('button', { name: /^I've verified$/i }));
    expect(await screen.findByText(/could not check right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/does not show this wallet as verified/i)).toBeNull();
  });
});
