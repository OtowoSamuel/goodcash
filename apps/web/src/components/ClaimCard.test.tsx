import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClaimCard, type ClaimDeps } from './ClaimCard';

const W = '0x2222222222222222222222222222222222222222';

function deps(over: Partial<ClaimDeps> = {}): ClaimDeps {
  return {
    readClaim: vi.fn(async () => ({ readyG: 120.87, nextAt: 0 })),
    needsClaimGas: vi.fn(async () => false),
    askClaimGas: vi.fn(async () => 'sent' as const),
    waitForClaimGas: vi.fn(async () => true),
    sendClaim: vi.fn(async () => '0xabc' as const),
    confirmClaim: vi.fn(async () => 120.87),
    ...over,
  };
}

describe('ClaimCard', () => {
  it('offers the daily G$ to someone not verified yet, and its button opens the one-time step', () => {
    const onVerify = vi.fn();
    render(<ClaimCard wallet={W} verified="not_verified" onVerify={onVerify} deps={deps()} />);
    expect(screen.queryByText(/verify/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Claim free G$' }));
    expect(onVerify).toHaveBeenCalled();
  });

  it('shows nothing while verification is still being checked', () => {
    const { container } = render(<ClaimCard wallet={W} verified="checking" onVerify={() => undefined} deps={deps()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('claims in one tap and says what arrived', async () => {
    const d = deps();
    const onClaimed = vi.fn();
    render(<ClaimCard wallet={W} verified="verified" onVerify={() => undefined} onClaimed={onClaimed} deps={d} />);
    expect(await screen.findByText((_, el) => el?.className === 'gc-claim__amount' && el.textContent === '+120.87 G$')).toBeInTheDocument();
    (d.readClaim as ReturnType<typeof vi.fn>).mockResolvedValue({ readyG: 0, nextAt: Date.now() + 5 * 3600_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    expect(await screen.findByText('Claimed today')).toBeInTheDocument();
    expect(onClaimed).toHaveBeenCalledWith(120.87);
    expect(d.askClaimGas).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/Next free G\$ in/)).toBeInTheDocument());
  });

  it('gets the network fee first when the wallet has none', async () => {
    const d = deps({ needsClaimGas: vi.fn(async () => true) });
    render(<ClaimCard wallet={W} verified="verified" onVerify={() => undefined} deps={d} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    expect(await screen.findByText('Claimed today')).toBeInTheDocument();
    expect(d.askClaimGas).toHaveBeenCalledWith(W);
    expect(d.sendClaim).toHaveBeenCalled();
  });

  it('when the fee cannot be had, says so plainly and offers to add CELO, without asking the wallet', async () => {
    const onAddCelo = vi.fn();
    const d = deps({ needsClaimGas: vi.fn(async () => true), askClaimGas: vi.fn(async () => 'refused' as const) });
    render(<ClaimCard wallet={W} verified="verified" onVerify={() => undefined} onAddCelo={onAddCelo} deps={d} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    expect(await screen.findByText(/needs a little CELO/)).toBeInTheDocument();
    expect(d.sendClaim).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add a little CELO' }));
    expect(onAddCelo).toHaveBeenCalled();
  });

  it('shows when the next claim opens once today is claimed', async () => {
    const d = deps({ readClaim: vi.fn(async () => ({ readyG: 0, nextAt: Date.now() + 3 * 3600_000 + 5 * 60_000 })) });
    render(<ClaimCard wallet={W} verified="verified" onVerify={() => undefined} deps={d} />);
    expect(await screen.findByText(/Today's is claimed/, undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/3h \d+m/)).toBeInTheDocument();
  });

  it('a cancel in the wallet leaves the claim ready to try again', async () => {
    const d = deps({ sendClaim: vi.fn(async () => { throw Object.assign(new Error('User rejected'), { code: 4001 }); }) });
    render(<ClaimCard wallet={W} verified="verified" onVerify={() => undefined} deps={d} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    expect(await screen.findByText(/You cancelled in your wallet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claim' })).toBeEnabled();
  });
});
