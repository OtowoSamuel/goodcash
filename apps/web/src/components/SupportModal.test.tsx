import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SupportModal } from './SupportModal';

const context = { orderId: 'ord-123', txHash: '0x' + 'ab'.repeat(32), wallet: '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF', status: 'On its way' };

let store: Record<string, string> = {};
beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('SupportModal', () => {
  it('asks for a reply email and a real description before sending', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<SupportModal context={context} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/email address/i);
    fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: 'me@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 10 characters/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the cash out details with the message and shows the ticket reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ticketId: 'GC-ABC234' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SupportModal context={context} defaultTopic="not_arrived" onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText(/tell us what happened/i), { target: { value: 'My bank has not received anything yet' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => expect(screen.getByText('GC-ABC234')).toBeInTheDocument());
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.email).toBe('me@example.com');
    expect(sent.topic).toBe('not_arrived');
    expect(sent.context.orderId).toBe('ord-123');
    expect(sent.context.txHash).toBe(context.txHash);
    expect(sent.context.wallet).toBe(context.wallet);
    expect(JSON.stringify(sent)).not.toMatch(/accountNumber|accountName|institution/i);
    expect(store['goodcash_support_email']).toBe('me@example.com');
  });

  it('offers an email fallback when the form cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<SupportModal context={context} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText(/tell us what happened/i), { target: { value: 'It never arrived and I am worried' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));
    await waitFor(() => expect(screen.getByRole('link', { name: /email us instead/i })).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't send/i);
  });
});
