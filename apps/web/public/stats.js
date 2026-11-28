(function () {
  var API = 'https://api.goodcash.xyz/stats';
  var EXPLORER = 'https://celo.blockscout.com';
  var $ = function (id) { return document.getElementById(id); };
  var nf = new Intl.NumberFormat('en-US');
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  var naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
  var lagos = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' });
  var dayMonth = function (iso) { return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function plural(n, one, many) { return n === 1 ? one : many; }
  /** 6,875,317 -> 6.9M, 52,000 -> 52K: short labels for chart bars */
  function short(n) {
    if (n >= 1e6) return (Math.round(n / 1e5) / 10) + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    return nf.format(n);
  }
  function rows(id, items) {
    var dl = $(id);
    items.forEach(function (it) {
      if (it[1] === null || it[1] === undefined) return;
      var d = el('div');
      d.appendChild(el('dt', '', it[0]));
      d.appendChild(el('dd', '', it[1]));
      dl.appendChild(d);
    });
  }
  function chip(text) { $('week').appendChild(el('span', 'chip', text)); }

  // ---------------------------------------------------------------- weekly chart
  var series = {};
  function drawChart(key) {
    var s = series[key];
    var bars = $('bars'), dates = $('dates');
    bars.textContent = ''; dates.textContent = '';
    var max = Math.max.apply(null, s.data.map(function (d) { return d.v; }).concat([1]));
    s.data.forEach(function (d, i) {
      var col = el('div', 'col');
      col.appendChild(el('span', 'v', short(d.v)));
      var bar = el('div', 'bar' + (i === s.data.length - 1 ? ' now' : ''));
      bar.style.height = d.v ? Math.max(4, (d.v / max) * 82) + '%' : '3px';
      if (!d.v) bar.style.opacity = '.35';
      col.appendChild(bar);
      bars.appendChild(col);
      dates.appendChild(el('span', '', i === s.data.length - 1 ? 'This week' : dayMonth(d.date)));
    });
    bars.setAttribute('aria-label', s.label + ' per week: ' + s.data.map(function (d) { return 'week of ' + dayMonth(d.date) + ', ' + nf.format(d.v); }).join('; '));
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-selected', String(tabs[i].getAttribute('data-k') === key));
  }
  function setupChart(s) {
    var weeks = s.weekly.map(function (w) { return w.date; });
    var byDate = function (list, field) {
      var m = {};
      (list || []).forEach(function (w) { m[w.date] = w[field]; });
      return weeks.map(function (d) { return { date: d, v: m[d] || 0 }; });
    };
    var all = {
      cashOuts: { label: 'Cash outs', data: byDate(s.weekly, 'cashOuts') },
      gDollars: { label: 'G$ cashed out', data: byDate(s.weekly, 'gDollars') },
      topUps: { label: 'Top-ups', data: byDate(s.topUps && s.topUps.weekly, 'topUps') },
      wallets: { label: 'New wallets', data: byDate(s.usage && s.usage.newWeekly, 'wallets') },
    };
    // Start at the first week anything happened, so the chart is not mostly empty weeks before launch
    var first = weeks.length - 1;
    Object.keys(all).forEach(function (k) {
      all[k].data.forEach(function (d, i) { if (d.v && i < first) first = i; });
    });
    Object.keys(all).forEach(function (k) {
      all[k].data = all[k].data.slice(first);
      series[k] = all[k];
    });
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function (e) { drawChart(e.currentTarget.getAttribute('data-k')); });
    }
    drawChart('cashOuts');
    $('weekly').hidden = false;
  }

  function show(s) {
    var updated = $('updated');
    updated.lastChild.textContent = 'Live, updated ' + lagos.format(new Date(s.updatedAt));
    if (s.excluded && s.excluded.cashOuts) {
      $('excluded').textContent = 'Not counted: ' + nf.format(s.excluded.cashOuts) + ' test ' + plural(s.excluded.cashOuts, 'cash out', 'cash outs') + ' from our own wallets.';
    }
    var pe = s.people, u = s.topUps, us = s.usage, t = s.totals;

    // Hero
    $('h-people').textContent = pe ? nf.format(pe.verifiedPeople) : '–';
    $('hl-people').textContent = pe ? plural(pe.verifiedPeople, 'verified person', 'verified people') : 'verified people';
    $('h-g').textContent = nf.format(t.gDollars);
    $('h-usd').textContent = 'worth ' + usd.format(t.dollars);
    $('h-cashouts').textContent = nf.format(t.cashOuts);
    $('hl-cashouts').textContent = plural(t.cashOuts, 'cash out', 'cash outs');
    $('h-naira').textContent = u ? naira.format(u.naira) : '–';
    $('h-topups').textContent = u ? 'in ' + nf.format(u.topUps) + plural(u.topUps, ' top-up', ' top-ups') : '';
    $('hero').classList.remove('skel');

    // This week
    var w = s.weekly[s.weekly.length - 1];
    var uw = u && u.weekly[u.weekly.length - 1];
    if (w.cashOuts || (uw && uw.topUps)) {
      if (w.cashOuts) { chip(nf.format(w.cashOuts) + plural(w.cashOuts, ' cash out', ' cash outs')); chip(short(w.gDollars) + ' G$ cashed out'); }
      if (uw && uw.topUps) chip(nf.format(uw.topUps) + plural(uw.topUps, ' top-up', ' top-ups') + ', ' + naira.format(uw.naira));
      $('week').hidden = false;
    }

    setupChart(s);

    // Detail cards
    rows('r-people', [
      ['Verified people', pe ? nf.format(pe.verifiedPeople) : null],
      ['Wallets used', us ? nf.format(us.wallets) : null],
      ['Came back for more', us ? nf.format(us.cameBack) : null],
      ['Both cashed out and added', us ? nf.format(us.usedBoth) : null],
      ['Partner apps', s.partners && s.partners.active > 0 ? nf.format(s.partners.active) : null],
    ]);
    rows('r-cash', [
      ['Cash outs', nf.format(t.cashOuts)],
      ['G$ cashed out', nf.format(t.gDollars)],
      ['Worth in US dollars', usd.format(t.dollars)],
      ['Average cash out', t.cashOuts ? usd.format(t.dollars / t.cashOuts) : '–'],
      ['Came back for more', nf.format(t.repeatWallets)],
    ]);
    if (u) {
      if (u.firstAt) $('since').textContent = 'Counted since ' + new Date(u.firstAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }) + '.';
      rows('r-top', [
        ['Top-ups', nf.format(u.topUps)],
        ['Naira added', naira.format(u.naira)],
        ['Average top-up', u.topUps ? naira.format(u.naira / u.topUps) : '–'],
        ['Came back for more', us ? nf.format(us.topUpCameBack) : null],
      ]);
    }

    // Latest cash outs
    var list = $('recent');
    if (!s.recent.length) list.appendChild(el('p', 'def', 'No cash outs yet.'));
    s.recent.forEach(function (r) {
      var item = el('div', 'item');
      var left = el('div');
      left.appendChild(el('div', 'when', lagos.format(new Date(r.time))));
      left.appendChild(el('div', 'who', r.wallet));
      var amt = el('div', 'amt');
      amt.appendChild(el('b', '', nf.format(r.gDollars) + ' G$'));
      amt.appendChild(el('span', '', usd.format(r.dollars)));
      var a = el('a', '', 'Receipt ↗');
      a.href = EXPLORER + '/tx/' + r.tx; a.rel = 'noopener noreferrer'; a.target = '_blank';
      a.setAttribute('aria-label', 'Receipt for the cash out on ' + lagos.format(new Date(r.time)) + ', opens the block explorer');
      item.appendChild(left); item.appendChild(amt); item.appendChild(a);
      list.appendChild(item);
    });

    var rt = $('routers');
    s.routers.forEach(function (r) {
      var tr = el('tr'), td = el('td'), a = el('a', '', r.name);
      a.href = EXPLORER + '/address/' + r.address; a.rel = 'noopener noreferrer'; a.target = '_blank';
      td.appendChild(a); tr.appendChild(td);
      tr.appendChild(el('td', 'n', nf.format(r.cashOuts)));
      tr.appendChild(el('td', 'n', nf.format(r.gDollars)));
      rt.appendChild(tr);
    });
  }

  fetch(API).then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); }).then(show).catch(function () {
    $('updated').lastChild.textContent = '';
    var e = $('error'); e.hidden = false; e.textContent = 'The numbers are not available right now. Please try again in a few minutes.';
  });
})();
