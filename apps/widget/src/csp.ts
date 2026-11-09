/**
 * The widget's content security policy. The wallet options (Magic's Wallet Kit, which uses WalletConnect/Reown for
 * phone wallets and Coinbase) need the same few services the GoodCash app already allows, so this mirrors apps/web.
 */
export function widgetCsp(api: string, ancestors: string): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com https://fonts.reown.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${api} https://forno.celo.org https://*.walletconnect.com wss://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org https://*.reown.com wss://*.reown.com https://api.web3modal.org https://*.magic.link https://*.coinbase.com wss://*.coinbase.com`,
    'frame-src https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.com https://secure.walletconnect.org https://*.magic.link',
    "worker-src 'self'",
    `frame-ancestors ${ancestors}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}
