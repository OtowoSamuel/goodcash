import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VoteNudge } from './VoteNudge';
import type { Ballot } from '../lib/vote';

const W = '0x2222222222222222222222222222222222222222';
const ballot = (over: Partial<Ballot>): Ballot => ({ registered: true, power: 10, allocated: 0, mine: 0, partnerMine: 0, partnerActive: true, available: 10, active: true, spread: 0, projects: 0, ...over });

describe('VoteNudge', () => {
  it('asks someone who has not voted for GoodCash, and opens the vote screen', async () => {
    const onVote = vi.fn();
    render(<VoteNudge wallet={W} onVote={onVote} ballotOf={vi.fn(async () => ballot({}))} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vote' }));
    expect(onVote).toHaveBeenCalled();
    expect(screen.getByText(/Vote for GoodCash/)).toBeInTheDocument();
  });

  it('says nothing to someone who already voted for GoodCash, or when the ballot cannot be read', async () => {
    const voted = vi.fn(async () => ballot({ mine: 5 }));
    const { container, unmount } = render(<VoteNudge wallet={W} onVote={() => undefined} ballotOf={voted} />);
    await waitFor(() => expect(voted).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();
    const broken = vi.fn(async () => { throw new Error('down'); });
    const r2 = render(<VoteNudge wallet={W} onVote={() => undefined} ballotOf={broken} />);
    await waitFor(() => expect(broken).toHaveBeenCalled());
    expect(r2.container).toBeEmptyDOMElement();
  });

  it('says nothing when GoodCash is not an active project', async () => {
    const off = vi.fn(async () => ballot({ active: false }));
    const { container } = render(<VoteNudge wallet={W} onVote={() => undefined} ballotOf={off} />);
    await waitFor(() => expect(off).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
