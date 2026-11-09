import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const A = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;
const state = vi.hoisted(() => ({ magicEnabled: false }));
const restoreMagic = vi.hoisted(() => vi.fn());
const finishMagicLogin = vi.hoisted(() => vi.fn());

vi.mock('./wallet', async (orig) => {
  const real = await orig<typeof import('./wallet')>();
  return {
    ...real,
    get MAGIC_ENABLED() {
      return state.magicEnabled;
    },
    restoreMagic,
    finishMagicLogin,
  };
});

// Magic's own panel is not ours to test here: a stand-in that "connects" or "fails" on a button press
vi.mock('./MagicPanel', () => ({
  default: ({ onConnected, onError, onClose }: { onConnected: (r: unknown) => void; onError: (e: unknown) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Magic panel">
      <button onClick={() => onConnected({ method: 'wallet', walletAddress: A })}>panel-connect</button>
      <button onClick={() => onError(new Error('relay.walletconnect.org handshake failed'))}>panel-fail</button>
      <button onClick={onClose}>panel-close</button>
    </div>
  ),
}));

import { ConnectGate } from './ConnectGate';

const setEthereum = (e: unknown) => ((window as unknown as { ethereum?: unknown }).ethereum = e);

beforeEach(() => {
  state.magicEnabled = false;
  restoreMagic.mockReset().mockResolvedValue(null);
  finishMagicLogin.mockReset();
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { ethereum?: unknown }).ethereum;
});

const gate = (onConnected = vi.fn(), onClose = vi.fn()) => {
  render(<ConnectGate theme={{}} onConnected={onConnected} onClose={onClose} />);
  return { onConnected, onClose };
};

describe('Connect your wallet', () => {
  it('with no wallet anywhere, says so kindly and offers nothing that cannot work', () => {
    gate();
    expect(screen.getByRole('heading', { name: 'Connect your wallet' })).toBeTruthy();
    expect(screen.getByText(/No wallet was found/)).toBeTruthy();
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['✕']);
  });

  it("uses the browser's own wallet when there is one", async () => {
    const provider = { request: vi.fn(async () => [A]) };
    setEthereum(provider);
    const { onConnected } = gate();
    await userEvent.setup().click(screen.getByRole('button', { name: "Use this browser's wallet" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith({ address: A, provider }));
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
  });

  it('a customer who says no gets a calm message and the screen stays usable', async () => {
    setEthereum({ request: vi.fn(async () => { throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); }) });
    const { onConnected } = gate();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: "Use this browser's wallet" }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/cancelled the connection/i);
    expect(onConnected).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: "Use this browser's wallet" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('with Magic on: checks for a returning customer first, then offers "Choose a wallet" and connects through the panel', async () => {
    state.magicEnabled = true;
    const provider = { request: vi.fn() };
    finishMagicLogin.mockResolvedValue({ address: A, provider });
    const { onConnected } = gate();
    expect(screen.getByText('Checking for your wallet…')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Choose a wallet' }));
    await user.click(await screen.findByRole('button', { name: 'panel-connect' }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith({ address: A, provider }));
    expect(finishMagicLogin).toHaveBeenCalledWith({ method: 'wallet', walletAddress: A });
  });

  it('a returning customer is reconnected without any tap', async () => {
    state.magicEnabled = true;
    const w = { address: A, provider: { request: vi.fn() } };
    restoreMagic.mockResolvedValue(w);
    const { onConnected } = gate();
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(w));
  });

  it('with a browser wallet AND Magic, both are offered, the browser wallet first', async () => {
    state.magicEnabled = true;
    setEthereum({ request: vi.fn(async () => [A]) });
    gate();
    await screen.findByRole('button', { name: 'Other wallets or email' });
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names.indexOf("Use this browser's wallet")).toBeLessThan(names.indexOf('Other wallets or email'));
  });

  it('if the panel fails, the customer sees plain words, never the technical error', async () => {
    state.magicEnabled = true;
    gate();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Choose a wallet' }));
    await user.click(await screen.findByRole('button', { name: 'panel-fail' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("We couldn't connect your wallet. Please try again, or pick another wallet.");
    expect(document.body.textContent).not.toMatch(/relay|walletconnect\.org|handshake/i);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing the panel brings back the choices; the screen can be closed', async () => {
    state.magicEnabled = true;
    const { onClose } = gate();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Choose a wallet' }));
    await user.click(await screen.findByRole('button', { name: 'panel-close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('plain words only', async () => {
    state.magicEnabled = true;
    setEthereum({ request: vi.fn() });
    gate();
    await screen.findByRole('button', { name: 'Other wallets or email' });
    expect(document.body.textContent).not.toMatch(/swap|slippage|gas|usdt|paycrest|relay|quote|magic|walletconnect/i);
  });
});
