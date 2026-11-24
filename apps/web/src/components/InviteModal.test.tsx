import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ReferralSummary } from '../lib/referral';

const m = vi.hoisted(() => ({ fetchReferralSummary: vi.fn(), fetchPaycrestRate: vi.fn() }));
vi.mock('../lib/referral', async (orig) => ({ ...(await orig<typeof import('../lib/referral')>()), fetchReferralSummary: m.fetchReferralSummary }));
vi.mock('../lib/rate', async (orig) => ({ ...(await orig<typeof import('../lib/rate')>()), fetchPaycrestRate: m.fetchPaycrestRate }));

import { InviteModal } from './InviteModal';

const W = '0x2222222222222222222222222222222222222222';
const base: ReferralSummary = { open: true, endsAt: '2026-12-31T23:59:59Z', waiting: 0, friends: 0, perFriends: 2, rewardG: 6500, maxFriends: 20, paidG: 0, pendingG: 0, verified: true };

describe('InviteModal', () => {
  beforeEach(() => {
    m.fetchReferralSummary.mockReset();
    m.fetchPaycrestRate.mockReset().mockResolvedValue(1439);
  });

  it('explains the offer plainly, with the naira it is about', async () => {
    m.fetchReferralSummary.mockResolvedValue(base);
    render(<InviteModal wallet={W} onClose={() => undefined} />);
    expect(await screen.findByText(/Bring 2 friends, get G\$ 6,500 \(about ₦[\d,]+\)/)).toBeInTheDocument();
    expect(screen.getByText(/Nobody pays anything/)).toBeInTheDocument();
    expect(screen.getByText(/verify with GoodDollar for the first time/)).toBeInTheDocument();
    expect(screen.getByText(/already verified with GoodDollar before they opened your link do not count/)).toBeInTheDocument();
  });

  it('shows friends waiting, counted, paid and on the way', async () => {
    m.fetchReferralSummary.mockResolvedValue({ ...base, waiting: 3, friends: 4, paidG: 6500, pendingG: 6500 });
    render(<InviteModal wallet={W} onClose={() => undefined} />);
    expect(await screen.findByText('4')).toBeInTheDocument();
    expect(screen.getByText(/Joined, still to verify and claim/)).toBeInTheDocument();
    expect(screen.getByText(/Sent to your wallet/)).toBeInTheDocument();
    expect(screen.getByText(/On its way/)).toBeInTheDocument();
  });

  it('asks an unverified inviter to verify, and says when the rewards have ended', async () => {
    m.fetchReferralSummary.mockResolvedValue({ ...base, verified: false });
    const { unmount } = render(<InviteModal wallet={W} onClose={() => undefined} />);
    expect(await screen.findByText(/Verify your own wallet with GoodDollar/)).toBeInTheDocument();
    unmount();
    m.fetchReferralSummary.mockResolvedValue({ ...base, open: false });
    render(<InviteModal wallet={W} onClose={() => undefined} />);
    expect(await screen.findByText(/The invite rewards have ended/)).toBeInTheDocument();
  });
});
