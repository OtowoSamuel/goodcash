import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getWalletLink } from './walletConnect';

function stubStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  });
}

describe('getWalletLink', () => {
  beforeEach(() => vi.unstubAllGlobals());
  it('returns nothing when no phone wallet was picked', () => {
    stubStorage();
    expect(getWalletLink()).toBeNull();
  });
  it('reads the wallet WalletConnect remembered', () => {
    stubStorage({ WALLETCONNECT_DEEPLINK_CHOICE: JSON.stringify({ name: 'MetaMask', href: 'metamask://' }) });
    expect(getWalletLink()).toEqual({ name: 'MetaMask', href: 'metamask://' });
  });
  it('ignores junk', () => {
    stubStorage({ WALLETCONNECT_DEEPLINK_CHOICE: 'not json' });
    expect(getWalletLink()).toBeNull();
  });
});
