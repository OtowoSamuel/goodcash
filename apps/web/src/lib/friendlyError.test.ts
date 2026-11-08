import { describe, it, expect } from 'vitest';
import { friendlySwapError } from './router';

describe('friendlySwapError', () => {
  it('explains a rejected wallet request without raw call data', () => {
    const err = Object.assign(new Error('User rejected the request.\n\nRequest Arguments:\n data: 0x1038'), {
      name: 'UserRejectedRequestError',
    });
    const msg = friendlySwapError(err);
    expect(msg).toMatch(/cancelled/i);
    expect(msg).not.toMatch(/0x/);
  });

  it('explains a paused router (EnforcedPause 0xd93c0665)', () => {
    expect(friendlySwapError(new Error('reverted with custom error 0xd93c0665'))).toMatch(/paused/i);
  });

  it('keeps unknown errors to one short line', () => {
    const msg = friendlySwapError(new Error(`Boom\n${'x'.repeat(500)}`));
    expect(msg).toMatch(/couldn't confirm your cash out/i);
    expect(msg).toMatch(/check History/i);
    expect(msg.length).toBeLessThan(140);
  });
});

import { friendlyApiError } from './userMessage';
describe('friendlyApiError', () => {
  it('hides network and server details', () => {
    expect(friendlyApiError(new Error('Failed to fetch'))).toMatch(/connection/i);
    expect(friendlyApiError(new Error('HTTP 502'))).toMatch(/our side/i);
    expect(friendlyApiError(new Error('TypeError: x is undefined at 0xabcdef'))).toMatch(/try again/i);
  });
});

describe('no jargon in cash-out errors', () => {
  it('never says swap, quote or names the network', async () => {
    const { friendlySwapError, SwapPendingError } = await import('./router');
    for (const e of [new Error('Swap transaction reverted on Celo'), new Error('execution reverted'), new SwapPendingError('0xabc'), new Error('CashOut event log not found in transaction receipt'), new Error('approval transaction failed')]) {
      const msg = friendlySwapError(e);
      expect(msg).not.toMatch(/\bswap|quote|\bCelo\b/i);
    }
  });
});
