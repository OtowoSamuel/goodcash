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
 *
 * Adding G$ / CELO when your app already has the customer's wallet (for example an email sign-in wallet): pass `wallet`
 * and a `signer` that is an EIP-1193 provider (or `signTypedData: async (typedData) => signature`). The customer is not
 * asked to connect again. `signTypedData(typedData, { orderId, maxUsdc, wallet })` also receives the order and the most it may
 * convert (6-decimal USDC units): refuse any value above maxUsdc. Your page signs the one permit with the wallet they are already using. Before it signs,
 * this script checks the permit is exactly a USDC authorization on Base from `wallet` (nothing else is ever signed).
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
    if (o.wallet && (o.signer || o.signTypedData)) q.set('bridge', '1');
    // The host can also sign the top-up permit (an EIP-1193 provider, or a signTypedData function)
    if (o.flow === 'topup' && o.wallet && ((o.signer && typeof o.signer.request === 'function') || typeof o.signTypedData === 'function')) q.set('typed', '1');
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

  var BASE_CHAIN = 8453;
  var BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

  /** Only ever sign the top-up permit: a USDC authorization on Base from this wallet, for a short time. */
  function checkPermit(td, wallet) {
    var d = td && td.domain;
    var m = td && td.message;
    if (!d || !m || td.primaryType !== 'ReceiveWithAuthorization') return 'This is not the top-up permit.';
    if (Number(d.chainId) !== BASE_CHAIN || String(d.verifyingContract).toLowerCase() !== BASE_USDC) return 'This is not a USDC permit on Base.';
    if (String(m.from).toLowerCase() !== String(wallet).toLowerCase()) return 'The permit is not from this wallet.';
    var now = Math.floor(Date.now() / 1000);
    if (!(Number(m.validBefore) > now && Number(m.validBefore) <= now + 3600)) return 'The permit time limit is not what is expected.';
    return null;
  }

  function signTyped(o, td, ctx) {
    var bad = checkPermit(td, o.wallet);
    if (!bad && ctx && /^\d{1,12}$/.test(String(ctx.maxUsdc))) {
      try { if (BigInt(td.message.value) > BigInt(ctx.maxUsdc)) bad = 'The amount is above what this order may convert.'; } catch (e) { bad = 'The amount is not readable.'; }
    }
    if (bad) return Promise.reject(new Error(bad));
    // ctx = { orderId, maxUsdc, wallet }: lets your own check be exact (refuse value above maxUsdc)
    if (typeof o.signTypedData === 'function') return Promise.resolve(o.signTypedData(td, ctx));
    var s = o.signer;
    if (!s || typeof s.request !== 'function') return Promise.reject(new Error('No signer'));
    var typed = { types: Object.assign({ EIP712Domain: [
      { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }
    ] }, td.types), primaryType: td.primaryType, domain: td.domain, message: td.message };
    var before = null;
    // Best effort: move the wallet to Base for this one signature, then back. A wallet that cannot switch (an email
    // sign-in wallet that stays on one network) signs for Base without switching.
    return Promise.resolve(s.request({ method: 'eth_chainId' })).then(function (c) { before = c; }, function () {}).then(function () {
      if (before && Number(before) === BASE_CHAIN) return;
      return Promise.resolve(s.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] })).then(function () {}, function () {});
    }).then(function () {
      return s.request({ method: 'eth_signTypedData_v4', params: [o.wallet, JSON.stringify(typed)] });
    }).then(function (sig) {
      return back().then(function () { return sig; });
    }, function (err) {
      return back().then(function () { throw err; });
    });
    function back() {
      if (!before || Number(before) === BASE_CHAIN) return Promise.resolve();
      return Promise.resolve(s.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: before }] })).then(function () {}, function () {});
    }
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
      if (d.type === 'sign_typed_data_request') {
        signTyped(o, d.typedData, { orderId: d.orderId, maxUsdc: d.maxUsdc, wallet: o.wallet }).then(
          function (signature) {
            e.source.postMessage({ source: 'goodcash-host', type: 'sign_result', id: d.id, signature: signature }, WIDGET);
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
      child = window.open(url, o.flow === 'topup' ? 'goodcash_topup' : 'goodcash_cashout', 'popup,width=480,height=800');
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
      frame.style.cssText = 'width:100%;max-width:500px;height:min(800px, calc(100vh - 24px));border:0;border-radius:24px;background:transparent;display:block;';
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

  window.GoodCash = Object.assign(window.GoodCash || {}, { open: open, version: '0.4.0' });
})();
