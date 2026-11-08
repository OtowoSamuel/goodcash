import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAddGsWatcher } from './useAddGsWatcher';
import { loadSavedAddGs, saveAddGs } from './addGsSaved';

const WALLET = '0x1111111111111111111111111111111111111111';
const ORDER = {
  orderId: '11111111-2222-3333-4444-555555555555',
  status: 'initiated',
  bank: { institution: 'B', accountIdentifier: '9990001111', accountName: 'P' },
  amountToTransfer: '1000',
  validUntil: '2030-01-01T00:00:00Z',
};
const REQ = '0x' + 'cd'.repeat(32);

function mockApi(o: { stage?: string; swap?: string }) {
  const posts: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST') posts.push(u);
      const body = u.includes('/relay/status') ? { status: o.swap ?? 'pending' } : { orderId: 'x', status: 's', stage: o.stage ?? 'waiting' };
      return new Response(JSON.stringify(body), { status: 200 });
    })
  );
  return posts;
}

const store = new Map<string, string>();
const storageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

describe('Add G$ watcher (works with the pop-up closed)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { value: storageMock, configurable: true });
    store.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('says "waiting" then "ready", and calls onReady exactly once when the money arrives', async () => {
    saveAddGs({ order: ORDER, wallet: WALLET });
    mockApi({ stage: 'waiting' });
    const onReady = vi.fn();
    const { result, rerender } = renderHook(({ stage }) => { mockApi({ stage }); return useAddGsWatcher({ wallet: WALLET, popupOpen: false, onReady, onArrived: vi.fn(), intervalMs: 20 }); }, { initialProps: { stage: 'waiting' } });
    await waitFor(() => expect(result.current).toBe('waiting'));
    rerender({ stage: 'done' });
    await waitFor(() => expect(result.current).toBe('ready'));
    await new Promise((r) => setTimeout(r, 80));
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(loadSavedAddGs(WALLET)?.readyNotified).toBe(true);
  });

  it('when the swap finishes: clears the saved order, calls onArrived, and tells the server', async () => {
    saveAddGs({ order: ORDER, wallet: WALLET, swapRequestId: REQ });
    const posts = mockApi({ swap: 'success' });
    const onArrived = vi.fn();
    renderHook(() => useAddGsWatcher({ wallet: WALLET, popupOpen: false, onReady: vi.fn(), onArrived, intervalMs: 20 }));
    await waitFor(() => expect(onArrived).toHaveBeenCalledTimes(1));
    expect(loadSavedAddGs(WALLET)).toBeNull();
    expect(posts.some((u) => u.includes('/arrived'))).toBe(true);
  });

  it('stays quiet while the pop-up is open, and does nothing without a saved order', async () => {
    saveAddGs({ order: ORDER, wallet: WALLET });
    const posts = mockApi({ stage: 'done' });
    const onReady = vi.fn();
    renderHook(() => useAddGsWatcher({ wallet: WALLET, popupOpen: true, onReady, onArrived: vi.fn(), intervalMs: 20 }));
    await new Promise((r) => setTimeout(r, 80));
    expect(onReady).not.toHaveBeenCalled();
    localStorage.clear();
    const { result } = renderHook(() => useAddGsWatcher({ wallet: WALLET, popupOpen: false, onReady, onArrived: vi.fn(), intervalMs: 20 }));
    await new Promise((r) => setTimeout(r, 60));
    expect(result.current).toBeNull();
    expect(posts).toHaveLength(0);
  });
});
