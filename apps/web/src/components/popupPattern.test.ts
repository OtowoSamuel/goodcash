import { describe, it, expect } from 'vitest';

// Reads every component's source text so a future pop-up cannot quietly break the house pattern
const sources = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const components = Object.entries(sources).filter(([name]) => !name.includes('.test.'));

describe('pop-up pattern', () => {
  it('no pop-up is anchored to the bottom of the screen', () => {
    const offenders = components
      .filter(([, src]) => /fixed inset-0[^"]*items-end/.test(src) || /items-end[^"]*fixed inset-0/.test(src))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it('every dialog is built on the shared Modal frame (ConfirmModal is the one older exception)', () => {
    const offenders = components
      .filter(([name, src]) => !/\/(Modal|ConfirmModal)\.tsx$/.test(name) && /role="dialog"/.test(src))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it('sees the real components (guard against an empty glob)', () => {
    expect(components.length).toBeGreaterThan(10);
  });
});
