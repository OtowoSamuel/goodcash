import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyReturn } from './VerifyReturn';
import type { Ballot } from '../lib/vote';
import type { VerifiedStatus } from '../lib/verified';

const W = '0x1234567890abcdef1234567890abcdef12345678';
const ballot = (patch: Partial<Ballot> = {}): Ballot => ({ registered: true, power: 10, allocated: 0, mine: 0, available: 10, active: true, projects: 0, spread: 0, ...patch }) as Ballot;
/** Let pending promises (the check, the ballot read) settle */
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const tick = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); for (let i = 0; i < 5; i++) await Promise.resolve(); });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(answers: VerifiedStatus[], opts: { intent?: 'cashout' | 'vote' | 'add-g'; ballotOf?: () => Promise<Ballot>; tries?: number } = {}) {
  const recheck = vi.fn(async () => answers.length > 1 ? answers.shift()! : answers[0]);
  const props = { onDone: vi.fn(), onVote: vi.fn(), onClose: vi.fn(), start: vi.fn(async () => undefined) };
  render(<VerifyReturn wallet={W} intent={opts.intent ?? 'cashout'} recheck={recheck} ballotOf={opts.ballotOf ?? (async () => ballot())} tries={opts.tries ?? 18} {...props} />);
  return { recheck, ...props };
}

describe('back from GoodDollar', () => {
  it('checks at once, then every 10 seconds until verified', async () => {
    const s = setup(['not_verified', 'not_verified', 'verified']);
    await flush();
    expect(s.recheck).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/checking with GoodDollar/i)).toBeInTheDocument();
    await tick(9_999);
    expect(s.recheck).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(s.recheck).toHaveBeenCalledTimes(2);
    await tick(10_000);
    expect(s.recheck).toHaveBeenCalledTimes(3);
    await flush();
    expect(screen.getByRole('dialog', { name: /Support GoodCash/i })).toBeInTheDocument();
    await tick(60_000);
    expect(s.recheck).toHaveBeenCalledTimes(3); // stops asking once verified
  });

  it('offers the optional vote; Skip goes straight on, Vote opens voting', async () => {
    const s = setup(['verified']);
    await flush();
    expect(screen.getByText(/Optional:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Skip for now/i }));
    expect(s.onDone).toHaveBeenCalledTimes(1);
    expect(s.onVote).not.toHaveBeenCalled();
  });

  it('Vote for GoodCash hands over to the vote screen', async () => {
    const s = setup(['verified']);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /Vote for GoodCash/i }));
    expect(s.onVote).toHaveBeenCalledTimes(1);
  });

  it('does not ask someone who already voted for GoodCash, or when the ballot cannot be read: straight on', async () => {
    const a = setup(['verified'], { ballotOf: async () => ballot({ mine: 10, available: 0 }) });
    await flush();
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: /Support GoodCash/i })).toBeNull();
  });

  it('when the ballot cannot be read, skips the optional step', async () => {
    const s = setup(['verified'], { ballotOf: async () => { throw new Error('rpc down'); } });
    await flush();
    expect(s.onDone).toHaveBeenCalledTimes(1);
  });

  it('someone who left to verify for voting goes straight to voting', async () => {
    const s = setup(['verified'], { intent: 'vote' });
    await flush();
    expect(s.onDone).toHaveBeenCalledTimes(1);
  });

  it('after the last check without success, prompts them to try again (signing with the same wallet) or check again', async () => {
    const s = setup(['not_verified'], { tries: 3 });
    await flush();
    await tick(10_000);
    await tick(10_000);
    expect(s.recheck).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/does not show this wallet as verified yet/i)).toBeInTheDocument();
    await tick(60_000);
    expect(s.recheck).toHaveBeenCalledTimes(3); // no more asking until they choose
    fireEvent.click(screen.getByRole('button', { name: /^Try again$/ }));
    await flush();
    expect(s.start).toHaveBeenCalledWith(W, 'cashout');
  });

  it('Check again starts another round of checks', async () => {
    const s = setup(['not_verified'], { tries: 1 });
    await flush();
    expect(s.recheck).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /^Check again$/ }));
    await flush();
    expect(s.recheck).toHaveBeenCalledTimes(2);
  });

  it('keeps to one check every 10 seconds even when the app re-renders with new callbacks (as the real app does)', async () => {
    const recheck = vi.fn(async (): Promise<VerifiedStatus> => 'not_verified');
    const el = (n: number) => <VerifyReturn wallet={W} intent="cashout" recheck={() => recheck()} ballotOf={async () => ballot()} onDone={() => n} onVote={() => n} onClose={() => n} start={async () => undefined} />;
    const { rerender } = render(el(0));
    await flush();
    for (let i = 1; i <= 20; i++) rerender(el(i));
    await flush();
    expect(recheck).toHaveBeenCalledTimes(1);
    await tick(10_000);
    expect(recheck).toHaveBeenCalledTimes(2);
  });
});
