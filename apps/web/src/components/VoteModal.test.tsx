import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Ballot, VoteFee } from '../lib/vote';

const m = vi.hoisted(() => ({
  readBallot: vi.fn(),
  estimateVoteFee: vi.fn(),
  readVerified: vi.fn(),
  registerVoter: vi.fn(),
  sendVote: vi.fn(),
  confirmVote: vi.fn(),
  loadPendingVote: vi.fn((): unknown => null),
  savePendingVote: vi.fn(),
}));

vi.mock('../lib/router', () => ({ celoText: (v: number) => (Math.ceil(v * 100) / 100).toFixed(2) }));
const startVerify = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../lib/goodid', async () => ({ ...(await vi.importActual<typeof import('../lib/goodid')>('../lib/goodid')), startGoodDollarVerification: (...a: unknown[]) => startVerify(...a) }));
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
  m.readVerified.mockResolvedValue(true);
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

  describe('step 1: verify with GoodDollar', () => {
    const unregistered = () => ballot({ registered: false, power: 0, available: 0 });

    it('verifies with the wallet already connected (no new login), with a button to check again', async () => {
      m.readBallot.mockResolvedValue(unregistered());
      m.readVerified.mockResolvedValue(false);
      startVerify.mockClear();
      open();
      fireEvent.click(await screen.findByRole('button', { name: /^verify with gooddollar$/i }));
      await waitFor(() => expect(startVerify).toHaveBeenCalledWith(expect.stringMatching(/^0x/i), 'vote'));
      expect(screen.queryByRole('button', { name: /^verify with gooddollar$/i })).toBeNull();
      expect(screen.getByRole('button', { name: /i've verified, check again/i })).toBeEnabled();
      expect(screen.queryByRole('button', { name: /^vote/i })).toBeNull();
      expect(m.registerVoter).not.toHaveBeenCalled();
    });

    it('moves on to the Vote button once the voter has verified and taps check again', async () => {
      m.readBallot.mockResolvedValue(unregistered());
      m.readVerified.mockResolvedValueOnce(false).mockResolvedValue(true);
      open();
      fireEvent.click(await screen.findByRole('button', { name: /i've verified, check again/i }));
      expect(await screen.findByRole('button', { name: 'Vote' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^verify with gooddollar$/i })).toBeNull();
    });

    it('shows the two steps, with step 1 done for a verified voter', async () => {
      m.readBallot.mockResolvedValue(unregistered());
      open();
      const steps = await screen.findByRole('list', { name: 'Steps' });
      expect(steps).toHaveTextContent('Verify with GoodDollar (done)');
      expect(steps).toHaveTextContent('Vote for GoodCash');
    });

    it('does not ask GoodDollar about a wallet that already has voting points', async () => {
      open();
      await voteButton();
      expect(m.readVerified).not.toHaveBeenCalled();
    });

    it('lets the voter try again when GoodDollar cannot be reached, and never calls it "not verified"', async () => {
      m.readBallot.mockResolvedValue(unregistered());
      m.readVerified.mockRejectedValueOnce(new Error('rpc down')).mockResolvedValue(true);
      open();
      expect(await screen.findByText(/could not check voting/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^verify with gooddollar$/i })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('button', { name: 'Vote' })).toBeInTheDocument();
    });
  });

  describe('step 2: one Vote button for a first-time voter', () => {
    const unregistered = () => ballot({ registered: false, power: 0, available: 0 });
    beforeEach(() => {
      m.readBallot.mockResolvedValueOnce(unregistered());
    });

    it('sets up their voting points, then votes with all of them, without a second button', async () => {
      m.registerVoter.mockResolvedValue('registered');
      m.readBallot.mockResolvedValue(ballot({ power: 10, available: 10 }));
      m.sendVote.mockResolvedValue('0x' + 'ab'.repeat(32));
      m.confirmVote.mockResolvedValue({ status: 'done', ballot: ballot({ mine: 10, available: 0, allocated: 10 }) });
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'Vote' }));
      await waitFor(() => expect(screen.getByText(/GoodCash now has 10 points/)).toBeInTheDocument(), { timeout: 8000 });
      expect(m.registerVoter).toHaveBeenCalledWith(WALLET);
      expect(m.sendVote).toHaveBeenCalledTimes(1);
      expect(m.sendVote).toHaveBeenCalledWith(WALLET, 10, 520_000n);
      // registering comes first
      expect(m.registerVoter.mock.invocationCallOrder[0]).toBeLessThan(m.sendVote.mock.invocationCallOrder[0]);
    });

    it('uses all the points the voter was given, not a fixed ten', async () => {
      m.registerVoter.mockResolvedValue('registered');
      m.readBallot.mockResolvedValue(ballot({ power: 500, available: 500 }));
      m.sendVote.mockResolvedValue('0x' + 'ab'.repeat(32));
      m.confirmVote.mockResolvedValue({ status: 'done', ballot: ballot({ mine: 500 }) });
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'Vote' }));
      await waitFor(() => expect(m.sendVote).toHaveBeenCalledWith(WALLET, 500, 520_000n), { timeout: 8000 });
    });

    it('stops before the vote when the wallet cannot pay the fee: voting is set up, and it offers to add CELO', async () => {
      m.registerVoter.mockResolvedValue('registered');
      m.readBallot.mockResolvedValue(ballot());
      m.estimateVoteFee.mockResolvedValue(fee({ enough: false, haveCelo: 0 }));
      const addCelo = vi.fn();
      open({ onAddCelo: addCelo });
      fireEvent.click(await screen.findByRole('button', { name: 'Vote' }));
      expect(await screen.findByText(/Add a little CELO for the network fee/, undefined, { timeout: 8000 })).toBeInTheDocument();
      expect(m.sendVote).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: /add celo with naira/i }));
      expect(addCelo).toHaveBeenCalled();
    });

    it('stops before the vote when the fee cannot be checked, and sends nothing', async () => {
      m.registerVoter.mockResolvedValue('registered');
      m.readBallot.mockResolvedValue(ballot());
      m.estimateVoteFee.mockRejectedValue(new Error('reverted'));
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'Vote' }));
      expect(await screen.findByText(/cannot send a vote right now/, undefined, { timeout: 8000 })).toBeInTheDocument();
      expect(m.sendVote).not.toHaveBeenCalled();
    });

    it('does not vote when the voter cancels the free signature', async () => {
      m.registerVoter.mockRejectedValue({ code: 4001 });
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'Vote' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled/i);
      expect(m.sendVote).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Vote' })).toBeEnabled();
    });

    it('waits for a slow node to show the new voting points before carrying on', async () => {
      m.registerVoter.mockResolvedValue('registered');
      m.readBallot.mockResolvedValueOnce(unregistered()).mockResolvedValue(ballot());
      m.sendVote.mockResolvedValue('0x' + 'ab'.repeat(32));
      m.confirmVote.mockResolvedValue({ status: 'done', ballot: ballot({ mine: 10 }) });
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'Vote' }));
      await waitFor(() => expect(m.sendVote).toHaveBeenCalledWith(WALLET, 10, 520_000n), { timeout: 10000 });
    });

    it.each([
      ['other_wallet', /already used its vote from another wallet/],
      ['busy', /busy right now/],
      ['error', /could not set up your vote/],
    ])('explains "%s" in plain words, sends no vote, and lets the voter try again', async (outcome, text) => {
      m.registerVoter.mockResolvedValue(outcome);
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'Vote' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(screen.getByRole('button', { name: 'Vote' })).toBeEnabled();
      expect(m.sendVote).not.toHaveBeenCalled();
    });

    it('moves back to step 1 when GoodDollar says the wallet is not verified after all', async () => {
      m.registerVoter.mockResolvedValue('not_verified');
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'Vote' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/has not verified this wallet/);
      expect(screen.getByRole('button', { name: /^verify with gooddollar$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /i've verified, check again/i })).toBeEnabled();
    });
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
