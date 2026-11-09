/**
 * Gentle polling for order status. Every check costs the server a few storage reads (and the free allowance is
 * limited), and an order tab can stay open all day. So:
 *  - checks start quick (the customer is watching), then slow down the longer an order takes;
 *  - nothing is asked while the tab is in the background; one check runs the moment it comes back.
 */

/** Delay before the next check, given how long we have been checking. `base` is the quick rate. */
export function backoffDelay(elapsedMs: number, base: number): number {
  if (elapsedMs < 2 * 60_000) return base;
  if (elapsedMs < 10 * 60_000) return Math.max(base, 30_000);
  return Math.max(base, 60_000);
}

interface Options {
  /** The quick rate, in ms */
  base: number;
  /** Replace the slowing-down rule (for example a fixed delay) */
  delay?: (elapsedMs: number) => number;
  /** Run the first check straight away (default true) */
  immediate?: boolean;
}

/** Runs `tick` now and then until the returned stop function is called. A slow `tick` never overlaps itself. */
export function startPolling(tick: () => unknown | Promise<unknown>, { base, delay, immediate = true }: Options): () => void {
  const startedAt = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const schedule = () => {
    if (stopped) return;
    const ms = (delay ?? ((e: number) => backoffDelay(e, base)))(Date.now() - startedAt);
    timer = setTimeout(run, ms);
  };
  const run = async () => {
    if (stopped) return;
    if (hidden()) return schedule(); // background tab: skip this check, ask again later
    if (running) return schedule();
    running = true;
    try {
      await tick();
    } catch {
      // a failed check is simply tried again
    } finally {
      running = false;
      schedule();
    }
  };
  const onVisible = () => {
    if (stopped || hidden()) return;
    if (timer) clearTimeout(timer);
    void run();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  if (immediate) void run();
  else schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}
