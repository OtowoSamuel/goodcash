/**
 * The wallet app the customer picked on their phone (WalletConnect remembers it). Phone browsers only let a page
 * open another app straight from a tap, so each wallet step shows an "Open wallet" button that uses this.
 */
export function getWalletLink(): { name: string; href: string } | null {
  try {
    const raw = localStorage.getItem('WALLETCONNECT_DEEPLINK_CHOICE');
    if (!raw) return null;
    const v = JSON.parse(raw) as { name?: unknown; href?: unknown };
    if (typeof v?.href !== 'string' || !v.href) return null;
    return { name: typeof v.name === 'string' && v.name ? v.name : 'your wallet', href: v.href };
  } catch {
    return null;
  }
}

/** Open the customer's wallet app. Call this only from a tap. */
export function openWalletApp(): void {
  const link = getWalletLink();
  if (link) window.location.href = link.href;
}
