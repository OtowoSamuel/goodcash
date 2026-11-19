import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Ballot, VoteFee } from '../lib/vote';

const m = vi.hoisted(() => ({
  readBallot: vi.fn(),
  estimateVoteFee: vi.fn(),
  registerVoter: vi.fn(),
  sendVote: vi.fn(),
  confirmVote: vi.fn(),
  loadPendingVote: vi.fn((): unknown => null),
  savePendingVote: vi.fn(),
}));

vi.mock('../lib/router', () => ({ celoText: (v: number) => (Math.ceil(v * 100) / 100).toFixed(2) }));
vi.mock('../lib/vote', async () => {
  const real = await vi.importActual<typeof import('../lib/vote')>('../lib/vote');
  return { ...real, ...m };
});

import { VoteModal } from './VoteModal';

const WALLET = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
const ballot = (o: Partial<Ballot> = {}): Ballot => ({ registered: true, power: 10, allocated: 0, mine: 0, available: 10, active: true, spread: 0, projects: 0, ...o });
const fee = (o: Partial<VoteFee> = {}): VoteFee => ({ gas: 520_000n, feeCelo: 0.0635, needCelo: 0.124, haveCelo: 1, enough: true, ...o });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.loadPendingVote.mockReturnValue(null);
  m.readBallot.mockResolvedValue(ballot());
  m.estimateVoteFee.mockResolvedValue(fee());
});
afterEach(() => vi.useRealTimers());

const open = (props: { onAddCelo?: () => void } = {}) => render(<VoteModal wallet={WALLET} onClose={() => {}} {...props} />);
const voteButton = () => screen.findByRole('button', { name: /vote with/i });

describe('VoteModal', () => {
  it('starts with all the voter\'s points chosen, shows the fee, and sends exactly that vote', async () => {
    m.sendVote.mockResolvedValue('0x' + 'ab'.repeat(32));
    m.confirmVote.mockResolvedValue({ status: 'done', ballot: ballot({ mine: 10, available: 0, allocated: 10 }) });
    open();
    const btn = await voteButton();
    expect(btn).toHaveTextContent('Vote with 10 points');
    await waitFor(() => expect(screen.getByText(/Your wallet has enough/)).toBeInTheDocument());
    expect(m.estimateVoteFee).toHaveBeenCalledWith(WALLET, 10);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(/Thank you!/)).toBeInTheDocument());
    expect(m.sendVote).toHaveBeenCalledWith(WALLET, 10, 520_000n);
    expect(screen.getByText(/GoodCash now has 10 points from you/)).toBeInTheDocument();
  });

  it('lets the voter choose fewer points, and the vote follows the slider', async () => {
    m.sendVote.mockResolvedValue('0x' + 'ab'.repeat(32));
    m.confirmVote.mockResolvedValue({ status: 'done', ballot: ballot({ mine: 4 }) });
    open();
    await voteButton();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '4' } });
    expect(await screen.findByRole('button', { name: 'Vote with 4 points' })).toBeInTheDocument();
    await waitFor(() => expect(m.estimateVoteFee).toHaveBeenLastCalledWith(WALLET, 4));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vote with 4 points' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Vote with 4 points' }));
    await waitFor(() => expect(m.sendVote).toHaveBeenCalledWith(WALLET, 4, 520_000n));
  });

  it('adds to existing support: the total sent is existing plus the new points', async () => {
    m.readBallot.mockResolvedValue(ballot({ mine: 2, allocated: 7, available: 3, projects: 2 }));
    open();
    const already = await screen.findByText(/You already support GoodCash/);
    expect(already.parentElement).toHaveTextContent('with 2 points');
    await voteButton();
    await waitFor(() => expect(m.estimateVoteFee).toHaveBeenCalledWith(WALLET, 5));
  });

  it('does not offer a vote until the fee is known, and not at all when the wallet cannot pay it', async () => {
    m.estimateVoteFee.mockResolvedValue(fee({ enough: false, haveCelo: 0, needCelo: 0.124 }));
    const addCelo = vi.fn();
    open({ onAddCelo: addCelo });
    const btn = await voteButton();
    await waitFor(() => expect(screen.getByText(/You need about/)).toBeInTheDocument());
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /add celo with naira/i }));
    expect(addCelo).toHaveBeenCalled();
    expect(m.sendVote).not.toHaveBeenCalled();
  });

  it('says so when the contract would refuse the vote, and sends nothing', async () => {
    m.estimateVoteFee.mockRejectedValue(new Error('reverted'));
    open();
    const btn = await voteButton();
    await waitFor(() => expect(screen.getByText(/cannot send a vote right now/)).toBeInTheDocument());
    expect(btn).toBeDisabled();
  });

  it('asks a wallet with no voting points to turn voting on, then shows the slider', async () => {
    m.readBallot.mockResolvedValueOnce(ballot({ registered: false, power: 0, available: 0 }));
    m.registerVoter.mockResolvedValue('registered');
    m.readBallot.mockResolvedValue(ballot());
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on voting' }));
    await voteButton();
    expect(m.registerVoter).toHaveBeenCalledWith(WALLET);
  });

  it.each([
    ['not_verified', /has not verified this wallet/],
    ['other_wallet', /already used its vote from another wallet/],
    ['busy', /busy right now/],
    ['error', /could not turn on voting/],
  ])('explains "%s" in plain words and lets the voter try again', async (outcome, text) => {
    m.readBallot.mockResolvedValue(ballot({ registered: false, power: 0, available: 0 }));
    m.registerVoter.mockResolvedValue(outcome);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on voting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: 'Turn on voting' })).toBeEnabled();
  });

  it('explains a voter who has spent every point elsewhere, with a link, and offers no vote', async () => {
    m.readBallot.mockResolvedValue(ballot({ allocated: 10, available: 0, projects: 1 }));
    open();
    expect(await screen.findByText(/used all 10 of your voting points/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Flow State' })).toHaveAttribute('href', expect.stringContaining('flowstate.network'));
    expect(screen.queryByRole('button', { name: /vote with/i })).toBeNull();
  });

  it('says so when voting for GoodCash is not open', async () => {
    m.readBallot.mockResolvedValue(ballot({ active: false }));
    open();
    expect(await screen.findByText(/not open right now/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /vote with/i })).toBeNull();
  });

  it('lets the voter try again when the chain cannot be read', async () => {
    m.readBallot.mockRejectedValueOnce(new Error('rpc down')).mockResolvedValue(ballot());
    open();
    expect(await screen.findByText(/could not check voting/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await voteButton();
  });

  it('puts the voter back on the vote screen, with a plain message, when they cancel in their wallet', async () => {
    m.sendVote.mockRejectedValue({ code: 4001 });
    open();
    await waitFor(() => expect(screen.getByRole('button', { name: /vote with/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /vote with/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled/i);
    expect(screen.getByRole('button', { name: /vote with/i })).toBeEnabled();
    expect(m.confirmVote).not.toHaveBeenCalled();
  });

  it('never sends again when a vote cannot be confirmed yet: it asks the voter to check back', async () => {
    m.sendVote.mockResolvedValue('0x' + 'ab'.repeat(32));
    m.confirmVote.mockResolvedValue({ status: 'unclear' });
    open();
    await waitFor(() => expect(screen.getByRole('button', { name: /vote with/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /vote with/i }));
    expect(await screen.findByText(/could not confirm your vote yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /vote with/i })).toBeNull();
    expect(m.sendVote).toHaveBeenCalledTimes(1);
  });

  it('follows a vote sent earlier instead of offering a new one', async () => {
    m.loadPendingVote.mockReturnValue({ hash: '0x' + 'cd'.repeat(32), newTotal: 10, at: 1 });
    m.confirmVote.mockResolvedValue({ status: 'done', ballot: ballot({ mine: 10 }) });
    open();
    expect(await screen.findByText(/GoodCash now has 10 points/)).toBeInTheDocument();
    expect(m.confirmVote).toHaveBeenCalledWith('0x' + 'cd'.repeat(32), 10, WALLET);
    expect(m.sendVote).not.toHaveBeenCalled();
  });

  it('after a vote that failed on the network, says nothing was taken and shows the vote screen again', async () => {
    m.sendVote.mockResolvedValue('0x' + 'ab'.repeat(32));
    m.confirmVote.mockResolvedValue({ status: 'failed' });
    open();
    await waitFor(() => expect(screen.getByRole('button', { name: /vote with/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /vote with/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing was taken/i);
  });
});
