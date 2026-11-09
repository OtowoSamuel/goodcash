import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoodCashProvider, TopUpButton } from '../src';

afterEach(() => {
  cleanup();
  delete (window as unknown as { GoodCash?: unknown }).GoodCash;
});

const KEY = 'gc_pk_test_' + 'a'.repeat(32);

describe('<TopUpButton />', () => {
  it('opens the hosted top-up page with the key, amount, asset and your reference', async () => {
    const open = vi.fn(() => ({ close: () => undefined }));
    (window as unknown as { GoodCash: unknown }).GoodCash = { open };
    render(
      <GoodCashProvider publishableKey={KEY}>
        <TopUpButton amountNaira={5000} asset="celo" partnerRef="player-1" mode="embed" />
      </GoodCashProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add G$ with naira' }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect((open.mock.calls[0] as unknown[])[0]).toMatchObject({ publishableKey: KEY, flow: 'topup', mode: 'embed', amountNaira: 5000, asset: 'celo', partnerRef: 'player-1' });
  });

  it('passes the events to your handler', async () => {
    const seen: string[] = [];
    (window as unknown as { GoodCash: unknown }).GoodCash = {
      open: (o: { onEvent: (e: { type: string }) => void }) => {
        o.onEvent({ type: 'topup.created' });
        o.onEvent({ type: 'topup.delivered' });
        return { close: () => undefined };
      },
    };
    render(
      <GoodCashProvider publishableKey={KEY}>
        <TopUpButton onEvent={(e) => seen.push(e.type)} />
      </GoodCashProvider>
    );
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(seen).toEqual(['topup.created', 'topup.delivered']));
  });

  it('tells your handler, in plain words, when the window cannot load', async () => {
    const seen: Array<{ type: string; message?: string }> = [];
    render(
      <GoodCashProvider publishableKey={KEY}>
        <TopUpButton widgetUrl="http://127.0.0.1:1/nope.js" onEvent={(e) => seen.push(e as never)} />
      </GoodCashProvider>
    );
    await userEvent.click(screen.getByRole('button'));
    // jsdom does not fetch scripts: fire the error ourselves
    await waitFor(() => expect(document.querySelector('script[src="http://127.0.0.1:1/nope.js"]')).toBeTruthy());
    document.querySelector('script[src="http://127.0.0.1:1/nope.js"]')!.dispatchEvent(new Event('error'));
    await waitFor(() => expect(seen[0]).toMatchObject({ type: 'error' }));
    expect(seen[0].message).not.toMatch(/undefined|Error:|TypeError/);
  });
});
