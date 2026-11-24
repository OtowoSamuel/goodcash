import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InviteAcceptCard } from './InviteAcceptCard';
import { REF_KEY } from '../lib/referral';

const W = '0x3333333333333333333333333333333333333333';
const A = '0x2222222222222222222222222222222222222222';

describe('InviteAcceptCard', () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows nothing without a saved invite', () => {
    const { container } = render(<InviteAcceptCard wallet={W} accept={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks to accept before verifying, and says it is free', async () => {
    localStorage.setItem(REF_KEY, A);
    const accept = vi.fn(async () => 'joined' as const);
    render(<InviteAcceptCard wallet={W} accept={accept} />);
    expect(screen.getByText(/before you verify/)).toBeInTheDocument();
    expect(screen.getByText(/No money is sent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText(/Invite accepted/)).toBeInTheDocument();
    expect(accept).toHaveBeenCalledWith(W);
  });

  it('explains plainly when the invite is not for this person', async () => {
    localStorage.setItem(REF_KEY, A);
    render(<InviteAcceptCard wallet={W} accept={vi.fn(async () => 'not_new' as const)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText(/for people new to GoodDollar/)).toBeInTheDocument();
  });

  it('lets them try again after cancelling in the wallet', async () => {
    localStorage.setItem(REF_KEY, A);
    render(<InviteAcceptCard wallet={W} accept={vi.fn(async () => { throw Object.assign(new Error('User rejected'), { code: 4001 }); })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText(/You cancelled/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
  });
});
