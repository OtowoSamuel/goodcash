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

  function draw(daily) {
    var svg = $('chart');
    var W = 900, H = 150, gap = 2, max = Math.max.apply(null, daily.map(function (d) { return d.cashOuts; }).concat([1]));
    var bw = W / daily.length; gap = 8;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    daily.forEach(function (d, i) {
      var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      var h = d.cashOuts ? Math.max(6, (d.cashOuts / max) * (H - 8)) : 3;
      r.setAttribute('x', String(i * bw + gap / 2)); r.setAttribute('width', String(bw - gap));
      r.setAttribute('y', String(H - h)); r.setAttribute('height', String(h));
      if (!d.cashOuts) r.setAttribute('class', 'zero');
      var t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = 'Week of ' + d.date + ': ' + d.cashOuts + (d.cashOuts === 1 ? ' cash out, ' : ' cash outs, ') + nf.format(d.gDollars) + ' G$';
      r.appendChild(t); svg.appendChild(r);
    });
    $('from').textContent = daily[0].date;
  }

  function show(s) {
    $('updated').textContent = 'Read from the Celo network · updated ' + stamp(s.updatedAt) + ' UTC';
    $('t-cashouts').textContent = nf.format(s.totals.cashOuts);
    $('t-g').textContent = nf.format(s.totals.gDollars);
    $('t-people').textContent = nf.format(s.totals.wallets);
    $('t-repeat').textContent = nf.format(s.totals.repeatWallets);
    $('t-usd').textContent = usd.format(s.totals.dollars);
    var w = s.last7Days;
    $('week').textContent = 'Last 7 days: ' + nf.format(w.cashOuts) + (w.cashOuts === 1 ? ' cash out' : ' cash outs') + ' from ' + nf.format(w.wallets) + (w.wallets === 1 ? ' wallet' : ' wallets') + ', ' + nf.format(w.gDollars) + ' G$.';
    draw(s.weekly);
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
