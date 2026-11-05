declare global {
  interface Window {
    ethereum?: {
      isMiniPay?: boolean;
      request?: (...args: unknown[]) => Promise<unknown>;
      isMetaMask?: boolean;
      [key: string]: unknown;
    };
  }
}

export function detectMiniPay(): boolean {
  if (typeof window === 'undefined') return false;
  const provider = window.ethereum;
  return Boolean(provider && provider.isMiniPay === true);
}

export function getCurrentPageUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.href;
}

export async function copyCurrentUrl(): Promise<boolean> {
  const url = getCurrentPageUrl();
  if (!url) return false;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(url);
      return true;
    }

    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    }
  } catch {
    return false;
  }

  return false;
}
