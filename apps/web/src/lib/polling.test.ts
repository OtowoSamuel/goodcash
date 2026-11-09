import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, startPolling } from './polling';

describe('backoffDelay', () => {
  it('is quick at first, then slows down', () => {
    expect(backoffDelay(0, 8000)).toBe(8000);
    expect(backoffDelay(119_000, 8000)).toBe(8000);
    expect(backoffDelay(3 * 60_000, 8000)).toBe(30_000);
    expect(backoffDelay(11 * 60_000, 8000)).toBe(60_000);
  });
  it('never goes faster than the base rate', () => {
    expect(backoffDelay(11 * 60_000, 90_000)).toBe(90_000);
  });
});

describe('startPolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('checks straight away, then at the quick rate, then slower, and stops when told', async () => {
    const tick = vi.fn(async () => undefined);
    const stop = startPolling(tick, { base: 8000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(112_000); // up to 2 minutes
    const atTwoMinutes = tick.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000); // now one check per 30s: 2 more, not 7
    expect(tick.mock.calls.length - atTwoMinutes).toBeLessThanOrEqual(2);
    stop();
    const after = tick.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tick.mock.calls.length).toBe(after);
  });

  it('asks nothing while the tab is in the background, and checks at once when it comes back', async () => {
    let state: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    const tick = vi.fn(async () => undefined);
    const stop = startPolling(tick, { base: 1000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tick).not.toHaveBeenCalled();
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a failing check does not stop the polling', async () => {
    const tick = vi.fn(async () => {
      throw new Error('offline');
    });
    const stop = startPolling(tick, { base: 1000 });
    await vi.advanceTimersByTimeAsync(3500);
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(3);
    stop();
  });
});
