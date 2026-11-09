/*!
 * GoodCash widget loader. https://pay.goodcash.xyz/docs
 *
 *   <script src="https://pay.goodcash.xyz/widget.js"></script>
 *   <script>
 *     const w = GoodCash.open({
 *       publishableKey: 'gc_pk_test_...',
 *       mode: 'popup',            // 'popup' | 'embed' | 'redirect'
 *       amountG: 5000,            // optional starting amount
 *       // To let people ADD G$ / CELO with naira instead: flow: 'topup', amountNaira: 5000, asset: 'g' | 'celo'
 *       // (events then carry e.topUp: topup.created, topup.paid_in, topup.delivered, topup.failed)
 *       partnerRef: 'player-42',  // optional, your own id
 *       onEvent: (e) => console.log(e.type, e.cashOut),
 *     });
 *     // w.close()
 *   </script>
 *
 * Embedded wallets (games): pass `wallet` and `signer` (an EIP-1193 provider, or async (tx) => txHash); the widget
 * then asks YOUR page to send the one transaction, and never sees any key.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var WIDGET = (function () {
    try {
      return new URL(script && script.src ? script.src : 'https://pay.goodcash.xyz/widget.js').origin;
    } catch (e) {
      return 'https://pay.goodcash.xyz';
    }
  })();

  function buildUrl(o) {
    var q = new URLSearchParams();
    q.set('key', o.publishableKey);
    q.set('mode', o.mode || 'popup');
    if (o.mode !== 'redirect') q.set('origin', window.location.origin);
    if (o.flow === 'topup') q.set('flow', 'topup');
    if (o.amountG != null) q.set('amountG', String(o.amountG));
    if (o.amountNaira != null) q.set('amountNaira', String(o.amountNaira));
    if (o.asset) q.set('asset', String(o.asset));
    if (o.partnerRef) q.set('ref', o.partnerRef);
    if (o.returnUrl) q.set('returnUrl', o.returnUrl);
    if (o.appId) q.set('app', o.appId);
    if (o.wallet) q.set('wallet', o.wallet);
    if (o.wallet && o.signer) q.set('bridge', '1');
    if (o.theme && o.theme.accent) q.set('accent', o.theme.accent);
    if (o.theme && o.theme.mode) q.set('theme', o.theme.mode);
    return WIDGET + '/?' + q.toString();
  }

  function sendWithSigner(signer, wallet, tx) {
    if (typeof signer === 'function') return Promise.resolve(signer(tx));
    if (signer && typeof signer.request === 'function') {
      return signer.request({ method: 'eth_sendTransaction', params: [{ from: wallet, to: tx.to, data: tx.data, value: '0x0' }] });
    }
    return Promise.reject(new Error('No signer'));
  }

  function open(o) {
    if (!o || !/^gc_pk_(live|test)_/.test(o.publishableKey || '')) throw new Error('GoodCash.open needs your publishable key (gc_pk_...).');
    var mode = o.mode || 'popup';
    var onEvent = typeof o.onEvent === 'function' ? o.onEvent : function () {};
    var url = buildUrl(Object.assign({}, o, { mode: mode }));
    var child = null;
    var overlay = null;
    var frame = null;

    if (mode === 'redirect') {
      if (!o.returnUrl) throw new Error('Redirect mode needs returnUrl.');
      window.location.assign(url);
      return { close: function () {} };
    }

    function cleanup() {
      window.removeEventListener('message', onMessage);
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (frame && frame.parentNode && !overlay) frame.parentNode.removeChild(frame);
      document.removeEventListener('keydown', onKey);
    }

    function onKey(e) {
      if (e.key === 'Escape' && overlay) close();
    }

    function close() {
      try {
        if (child && !child.closed && mode === 'popup') child.close();
      } catch (e) {}
      cleanup();
      onEvent({ type: 'closed' });
    }

    function onMessage(e) {
      if (e.origin !== WIDGET) return;
      var from = frame ? frame.contentWindow : child;
      if (e.source !== from) return;
      var d = e.data || {};
      if (d.source !== 'goodcash') return;
      if (d.type === 'sign_request') {
        sendWithSigner(o.signer, o.wallet, d.tx).then(
          function (hash) {
            e.source.postMessage({ source: 'goodcash-host', type: 'sign_result', id: d.id, hash: hash }, WIDGET);
          },
          function (err) {
            e.source.postMessage({ source: 'goodcash-host', type: 'sign_result', id: d.id, error: { code: err && err.code, message: String((err && err.message) || err) } }, WIDGET);
          }
        );
        return;
      }
      if (d.type === 'closed') {
        cleanup();
        onEvent({ type: 'closed' });
        return;
      }
      onEvent(d.topUp !== undefined ? { type: d.type, topUp: d.topUp } : { type: d.type, cashOut: d.cashOut });
    }

    window.addEventListener('message', onMessage);

    if (mode === 'popup') {
      child = window.open(url, o.flow === 'topup' ? 'goodcash_topup' : 'goodcash_cashout', 'popup,width=440,height=780');
      if (!child) {
        cleanup();
        onEvent({ type: 'error', code: 'popup_blocked', message: 'Your browser blocked the cash out window. Please allow pop-ups and try again.' });
        return { close: function () {} };
      }
    } else {
      frame = document.createElement('iframe');
      frame.src = url;
      frame.title = o.flow === 'topup' ? 'Add G$ with naira' : 'Cash out to your bank';
      frame.setAttribute('allow', 'clipboard-write');
      frame.style.cssText = 'width:100%;max-width:460px;height:min(780px, calc(100vh - 24px));border:0;border-radius:24px;background:transparent;display:block;';
      if (o.container) {
        o.container.appendChild(frame);
      } else {
        overlay = document.createElement('div');
        overlay.setAttribute('data-goodcash-overlay', '');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(17,17,17,.55);display:flex;align-items:center;justify-content:center;padding:12px;';
        overlay.addEventListener('mousedown', function (e) {
          if (e.target === overlay) close();
        });
        overlay.appendChild(frame);
        document.body.appendChild(overlay);
        document.addEventListener('keydown', onKey);
      }
    }
    return { close: close };
  }

  window.GoodCash = Object.assign(window.GoodCash || {}, { open: open, version: '0.1.0' });
})();
