// Get test keys (the form) and the confirmation pages for test and live keys (show the keys once). No libraries; text is set with textContent.
(function () {
  var API = 'https://api.goodcash.xyz';
  function el(id) { return document.getElementById(id); }
  function show(node, text, kind) {
    node.textContent = text;
    node.className = 'gcd-msg gcd-' + kind;
    node.hidden = false;
  }
  function errorText(body, status) {
    var e = body && body.error;
    if (e && e.detail) return e.message + ' ' + e.detail;
    if (e && e.message) return e.message;
    return status === 429 ? 'Too many tries. Please wait a minute and try again.' : 'Something went wrong. Please try again.';
  }
  function post(path, payload) {
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
    });
  }

  var form = el('gcd-form');
  if (form) {
    var msg = el('gcd-msg');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = el('gcd-submit');
      var origins = el('gcd-origins').value.split(/[\s,]+/).filter(Boolean);
      btn.disabled = true;
      show(msg, 'Sending…', 'info');
      post('/v1/signup', { name: el('gcd-name').value, email: el('gcd-email').value, origins: origins })
        .then(function (r) {
          if (r.ok) {
            form.hidden = true;
            show(msg, 'Check your email. We sent a link to confirm it is you. It works once and expires in one hour. If nothing arrives in a few minutes, check your spam folder.', 'ok');
          } else {
            btn.disabled = false;
            show(msg, errorText(r.body, r.status), 'err');
          }
        })
        .catch(function () {
          btn.disabled = false;
          show(msg, 'We could not reach GoodCash. Please check your connection and try again.', 'err');
        });
    });
  }

  var out = el('gcd-keys');
  if (out) {
    var status = el('gcd-msg');
    var token = (location.hash || '').replace(/^#/, '');
    // Take the token out of the address bar and history straight away
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
    var live = out.getAttribute('data-mode') === 'live';
    if (!/^[A-Za-z0-9]{40}$/.test(token)) {
      show(status, live ? 'This link is not valid. Please contact GoodCash for a new one.' : 'This link is not valid. Please ask for new test keys.', 'err');
    } else {
      show(status, live ? 'Getting your live keys…' : 'Creating your test keys…', 'info');
      post(live ? '/v1/live-keys/confirm' : '/v1/signup/confirm', { token: token })
        .then(function (r) {
          if (!r.ok) return show(status, errorText(r.body, r.status), 'err');
          status.hidden = true;
          var b = r.body;
          el('gcd-name').textContent = b.name;
          el('gcd-sites').textContent = b.allowedOrigins.join(', ');
          el('gcd-pk').textContent = b.publishableKey;
          el('gcd-sk').textContent = b.secretKey;
          out.hidden = false;
          document.querySelectorAll('[data-copy]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var text = el(btn.getAttribute('data-copy')).textContent;
              (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
                function () { btn.textContent = 'Copied'; },
                function () { btn.textContent = 'Select and copy it'; }
              );
            });
          });
        })
        .catch(function () { show(status, 'We could not reach GoodCash. Please try again.', 'err'); });
    }
  }
})();
