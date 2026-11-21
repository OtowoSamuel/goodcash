(function () {
  var API = 'https://api.goodcash.xyz/stats';
  var EXPLORER = 'https://celo.blockscout.com';
  var $ = function (id) { return document.getElementById(id); };
  var nf = new Intl.NumberFormat('en-US');
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  function cell(tr, text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    tr.appendChild(td);
    return td;
  }
  function stamp(iso) { return iso.slice(0, 16).replace('T', ' '); }
  function empty(tbody, cols, text) {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = cols; td.textContent = text; tr.appendChild(td); tbody.appendChild(tr);
  }

  function draw(daily, svgId, fromId, key, one, many, unit) {
    var svg = $(svgId);
    var W = 600, H = 170, gap = 2, max = Math.max.apply(null, daily.map(function (d) { return d[key]; }).concat([1]));
    var bw = W / daily.length; gap = 6;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    daily.forEach(function (d, i) {
      var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      var h = d[key] ? Math.max(6, (d[key] / max) * (H - 34)) : 3;
      r.setAttribute('x', String(i * bw + gap / 2)); r.setAttribute('width', String(bw - gap));
      r.setAttribute('y', String(H - h)); r.setAttribute('height', String(h));
      if (!d[key]) r.setAttribute('class', 'zero');
      var t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = 'Week of ' + d.date + ': ' + d[key] + (d[key] === 1 ? one : many) + unit(d);
      r.appendChild(t); svg.appendChild(r);
      if (d[key]) {
        var n = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        n.setAttribute('x', String(i * bw + bw / 2)); n.setAttribute('y', String(H - h - 6)); n.textContent = String(d[key]);
        svg.appendChild(n);
      }
    });
    $(fromId).textContent = 'Week of ' + new Date(daily[0].date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function plural(n, one, many) { return n === 1 ? one : many; }
  function longDate(iso) { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }

  function show(s) {
    $('updated').textContent = 'Updated ' + stamp(s.updatedAt) + ' UTC';
    if (s.excluded && s.excluded.cashOuts) {
      $('excluded').textContent = 'Not counted: ' + nf.format(s.excluded.cashOuts) + ' test ' + plural(s.excluded.cashOuts, 'cash out', 'cash outs') + ' from our own wallets.';
    }
    var naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });

    var u = s.topUps;
    if (u) {
      $('u-topups').textContent = nf.format(u.topUps);
      $('u-naira').textContent = naira.format(u.naira);
      $('u-people').textContent = nf.format(u.wallets);
      $('ul-people').textContent = plural(u.wallets, 'wallet', 'different wallets');
      $('u-avg').textContent = u.topUps ? naira.format(u.naira / u.topUps) : '–';
      if (u.firstAt) $('since').textContent = 'Counted since ' + longDate(u.firstAt) + '.';
      var uw = u.weekly[u.weekly.length - 1];
      $('uweek').textContent = u.topUps ? 'This week so far: ' + nf.format(uw.topUps) + plural(uw.topUps, ' top-up', ' top-ups') + (uw.topUps ? ', ' + naira.format(uw.naira) : '') + '.' : 'No top-ups counted yet.';
      draw(u.weekly, 'uchart', 'ufrom', 'topUps', ' top-up, ', ' top-ups, ', function (d) { return naira.format(d.naira); });
    }

    var us = s.usage;
    if (us && us.wallets > 0) {
      var pe = s.people;
      $('us-people').textContent = pe ? nf.format(pe.verifiedPeople) : '–';
      $('usl-people').textContent = pe ? plural(pe.verifiedPeople, 'verified person', 'verified people') : 'verified people (not available right now)';
      $('us-wallets').textContent = nf.format(us.wallets);
      $('usl-wallets').textContent = plural(us.wallets, 'wallet in total', 'different wallets in total');
      $('us-back').textContent = nf.format(us.cameBack);
      $('usl-back').textContent = plural(us.cameBack, 'wallet that came back', 'wallets that came back') + ' (2 or more top-ups or cash outs)';
      $('us-both').textContent = nf.format(us.usedBoth);
      $('usl-both').textContent = plural(us.usedBoth, 'wallet both added and cashed out', 'wallets both added and cashed out');
      $('us-tx').textContent = nf.format(s.totals.cashOuts + (u ? u.topUps : 0));
      if (s.partners && s.partners.active > 0) {
        $('us-partners').textContent = nf.format(s.partners.active);
        $('usl-partners').textContent = plural(s.partners.active, 'partner using the SDK', 'partners using the SDK');
        $('us-partners-tile').hidden = false;
      }
      if (pe && pe.wallets > pe.verifiedWallets) {
        var nv = pe.wallets - pe.verifiedWallets;
        $('us-not').textContent = nf.format(nv) + plural(nv, ' wallet is', ' wallets are') + ' not verified yet. Most were used before the verify step started on 20 Nov 2026.';
      }
      if (us.undated) $('us-undated').textContent = nf.format(us.undated) + plural(us.undated, ' wallet is', ' wallets are') + ' not in this chart because the date of their first top-up is not known yet.';
      draw(us.newWeekly, 'nchart', 'nfrom', 'wallets', ' new wallet', ' new wallets', function () { return ''; });
      $('users').hidden = false;
      if (u) {
        $('u-back').textContent = nf.format(us.topUpCameBack);
        $('ul-back').textContent = plural(us.topUpCameBack, 'wallet that came back', 'wallets that came back') + ' (2 or more top-ups)';
        $('u-back-tile').hidden = false;
      }
    }

    $('t-cashouts').textContent = nf.format(s.totals.cashOuts);
    $('t-g').textContent = nf.format(s.totals.gDollars);
    $('t-usd').textContent = usd.format(s.totals.dollars);
    $('t-avg').textContent = s.totals.cashOuts ? usd.format(s.totals.dollars / s.totals.cashOuts) : '–';
    $('t-people').textContent = nf.format(s.totals.wallets);
    $('t-repeat').textContent = nf.format(s.totals.repeatWallets);
    $('l-people').textContent = plural(s.totals.wallets, 'wallet', 'different wallets');
    $('l-repeat').textContent = plural(s.totals.repeatWallets, 'wallet that came back', 'wallets that came back');
    var w = s.weekly[s.weekly.length - 1];
    $('week').textContent = s.totals.cashOuts ? 'This week so far: ' + nf.format(w.cashOuts) + plural(w.cashOuts, ' cash out', ' cash outs') + (w.cashOuts ? ', ' + nf.format(w.gDollars) + ' G$' : '') + '.' : 'No cash outs yet.';
    draw(s.weekly, 'chart', 'from', 'cashOuts', ' cash out, ', ' cash outs, ', function (d) { return nf.format(d.gDollars) + ' G$'; });
    var rec = $('recent');
    if (!s.recent.length) empty(rec, 5, 'No cash outs yet.');
    s.recent.forEach(function (r) {
      var tr = document.createElement('tr');
      cell(tr, stamp(r.time)); cell(tr, r.wallet); cell(tr, nf.format(r.gDollars), 'n'); cell(tr, usd.format(r.dollars), 'n');
      var td = document.createElement('td'), a = document.createElement('a');
      a.href = EXPLORER + '/tx/' + r.tx; a.textContent = 'View'; a.rel = 'noopener noreferrer'; a.target = '_blank';
      td.appendChild(a); tr.appendChild(td); rec.appendChild(tr);
    });
    var rt = $('routers');
    s.routers.forEach(function (r) {
      var tr = document.createElement('tr'), td = document.createElement('td'), a = document.createElement('a');
      a.href = EXPLORER + '/address/' + r.address; a.textContent = r.name; a.rel = 'noopener noreferrer'; a.target = '_blank';
      td.appendChild(a); tr.appendChild(td); cell(tr, nf.format(r.cashOuts), 'n'); cell(tr, nf.format(r.gDollars), 'n'); rt.appendChild(tr);
    });
  }

  fetch(API).then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); }).then(show).catch(function () {
    $('updated').textContent = '';
    var e = $('error'); e.hidden = false; e.textContent = 'The numbers are not available right now. Please try again in a few minutes.';
  });
})();
