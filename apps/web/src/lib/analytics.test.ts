import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDuneQuerySpec,
  decodeCashOutEvent,
  emitAnalyticsEvent,
  PRIVACY_NOTICE,
  resetAnalyticsState,
} from './analytics';

describe('analytics tracking', () => {
  beforeEach(() => {
    resetAnalyticsState();
  });

  it('deduplicates repeated app events', () => {
    const first = emitAnalyticsEvent('quote_shown', {
      amount: 1000,
      route: 'reserve',
      price_impact: 0.4,
      estimated_naira: 1500,
    });

    const second = emitAnalyticsEvent('quote_shown', {
      amount: 1000,
      route: 'reserve',
      price_impact: 0.4,
      estimated_naira: 1500,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('removes PII and keeps only wallet-safe payload fields', () => {
    const event = emitAnalyticsEvent('order_created', {
      partner: 'paycrest',
      amount_bucket: '50-100',
      name: 'Jane Example',
      phone: '+2348000000000',
      bank: 'First bank',
    });

    expect(event).not.toBeNull();
    expect(event?.payload.partner).toBe('paycrest');
    expect(event?.payload.name).toBeUndefined();
    expect(event?.payload.phone).toBeUndefined();
    expect(event?.payload.bank).toBeUndefined();
  });

  it('decodes CashOut event payloads into Dune-friendly values', () => {
    const decoded = decodeCashOutEvent({
      user: '0x123',
      recipient: '0x456',
      tokenOut: '0xabc',
      amountIn: 123n,
      amountOut: 456n,
      route: 0,
      ref: 'ref-1',
    });

    expect(decoded.user).toBe('0x123');
    expect(decoded.route).toBe('0');
    expect(decoded.amountIn).toBe('123');
    expect(decoded.amountOut).toBe('456');
  });

  it('exposes a public Dune dashboard spec and privacy notice', () => {
    const spec = createDuneQuerySpec();

    expect(spec.metrics).toContain('cashout_completion_rate');
    expect(PRIVACY_NOTICE).toContain('wallet-level only');
  });
});
