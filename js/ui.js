/* ui.js — rendering and input handling. All mutation goes through ENGINE.actions. */
(function (G) {
  'use strict';
  var D = G.DATA, E = G.ENGINE;
  var UI = { tab: 'dash', S: null };

  /* ------------------------------------------------------------- helpers */
  function $(sel) { return document.querySelector(sel); }
  function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function money(n, dp) {
    var neg = n < 0; n = Math.abs(n);
    var s = n.toLocaleString(undefined, { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 });
    return (neg ? '-$' : '$') + s;
  }
  function pct(n, dp) { return (n * 100).toFixed(dp === undefined ? 0 : dp) + '%'; }
  function sign(n) { return n >= 0 ? 'pos' : 'neg'; }
  function bar(v, cls) { return '<div class="bar ' + (cls || '') + '"><i style="width:' + Math.max(0, Math.min(100, v * 100)) + '%"></i></div>'; }
  UI.money = money;

  function spark(vals, color) {
    if (!vals.length) return '<svg class="spark"></svg>';
    var w = 300, h = 54, lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi = lo + 1; }
    var pts = vals.map(function (v, i) {
      return (i / Math.max(1, vals.length - 1) * w).toFixed(1) + ',' + (h - 4 - ((v - lo) / (hi - lo)) * (h - 10)).toFixed(1);
    });
    var zero = lo < 0 && hi > 0 ? (h - 4 - ((0 - lo) / (hi - lo)) * (h - 10)) : null;
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      (zero !== null ? '<line x1="0" y1="' + zero.toFixed(1) + '" x2="' + w + '" y2="' + zero.toFixed(1) + '" stroke="#3a4753" stroke-dasharray="3 3"/>' : '') +
      '<polyline fill="none" stroke="' + (color || '#ffb020') + '" stroke-width="2" stroke-linejoin="round" points="' + pts.join(' ') + '"/></svg>';
  }

  function avgOf(hist, key, n) {
    var a = hist.slice(-n).filter(function (d) { return d[key] !== null && d[key] !== undefined; });
    if (!a.length) return 0;
    return a.reduce(function (t, d) { return t + d[key]; }, 0) / a.length;
  }
  function sumOf(hist, key, n) {
    return hist.slice(-n).reduce(function (t, d) { return t + (d[key] || 0); }, 0);
  }

  /* --------------------------------------------------------------- toast */
  UI.toast = function (msg, kind) {
    var box = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(function () { el.remove(); }, 3000);
  };

  UI.modal = function (title, body, footer) {
    var host = document.getElementById('modals');
    host.innerHTML = '<div class="veil"><div class="modal">' +
      '<div class="mh"><h3>' + title + '</h3><button class="btn ghost sm" data-act="closeModal">Close</button></div>' +
      '<div class="mb">' + body + '</div>' +
      (footer ? '<div class="mf">' + footer + '</div>' : '') +
      '</div></div>';
  };
  UI.closeModal = function () { document.getElementById('modals').innerHTML = ''; };

  /* ---------------------------------------------------------------- head */
  var TABS = [
    { id: 'dash', name: 'Dashboard' },
    { id: 'counter', name: 'Front Counter' },
    { id: 'bays', name: 'Bays & Tools' },
    { id: 'crew', name: 'Crew' },
    { id: 'parts', name: 'Parts' },
    { id: 'marketing', name: 'Marketing' },
    { id: 'reports', name: 'Reports' }
  ];

  function alerts(s) {
    var out = [];
    var last = s.history[s.history.length - 1];
    if (s.cash < 6000) out.push({ k: 'bad', t: 'Cash is down to ' + money(s.cash) + '. Anything more and you are drawing on the credit line at 24%.' });
    if (s.credit.balance > 1000) out.push({ k: 'bad', t: 'Line of credit balance: ' + money(s.credit.balance) + ' at 24% APR. Pay it down.' });
    if (last && last.turnedAway >= 2) out.push({ k: 'warn', t: 'Turned away ' + Math.round(last.turnedAway) + ' customers yesterday — the lot was full. Those customers went somewhere else.' });
    if (last && last.lostNoCapability >= 2) out.push({ k: 'warn', t: 'Lost ' + Math.round(last.lostNoCapability) + ' jobs yesterday you are not equipped or certified to do. See Bays &amp; Tools and Crew.' });
    if (s.wip.length >= s.parking) out.push({ k: 'warn', t: 'The lot is packed with ' + s.wip.length + ' unfinished cars. Nothing new is getting in.' });
    var lowMorale = s.techs.filter(function (t) { return t.morale < 35; });
    if (lowMorale.length) out.push({ k: 'bad', t: lowMorale.map(function (t) { return t.name; }).join(', ') + ' — morale is critical. Expect a resignation.' });
    var tired = s.techs.filter(function (t) { return t.fatigue > 0.75; });
    if (tired.length) out.push({ k: 'warn', t: tired.map(function (t) { return t.name; }).join(', ') + ' are burned out. Fatigue raises comebacks and slows flat-rate hours.' });
    if (!s.writers.length) out.push({ k: 'bad', t: 'You have no service writer. Almost nothing is getting sold.' });
    if (!s.techs.length) out.push({ k: 'bad', t: 'You have no technicians. Nothing is getting fixed.' });
    var totalAds = D.CHANNELS.reduce(function (t, c) { return t + s.channels[c.id].spend; }, 0);
    if (totalAds === 0 && s.day > 3) out.push({ k: 'info', t: 'You are spending nothing on marketing. Your car count is whatever walks in on reputation alone.' });
    if (s.pendingFleet) out.push({ k: 'info', t: s.pendingFleet.name + ' is waiting on an answer about a fleet contract.', act: 'fleetDecide' });
    var promo = s.techs.filter(function (t) { return t.readyToPromote; }).concat(s.writers.filter(function (w) { return w.readyToPromote; }));
    if (promo.length) out.push({ k: 'good', t: promo.map(function (p) { return p.name; }).join(', ') + ' ' + (promo.length > 1 ? 'have' : 'has') + ' earned a promotion.' });
    return out;
  }

  function renderHead(s) {
    $('#shopName').textContent = s.shopName;
    $('#dateLine').textContent = 'Day ' + s.day + ' · ' + (s.day === 0 ? 'Opening day' : D.DOW[s.dow] + ' · ' + s.season) +
      (s.dow === 6 && s.day > 0 ? ' · CLOSED' : '');
    var last = s.history[s.history.length - 1];
    var net30 = sumOf(s.history, 'netProfit', 30);
    var rating = E.rating(s);
    $('#headStats').innerHTML = [
      ['Cash', money(s.cash), s.cash < 8000 ? 'neg' : ''],
      ['Net worth', money(E.netWorth(s)), ''],
      ['Rating', rating.toFixed(1) + '★', rating >= 4.3 ? 'pos' : rating < 3.6 ? 'neg' : ''],
      ['Reputation', Math.round(s.reputation), ''],
      ['Yesterday', last ? money(last.netProfit) : '—', last ? sign(last.netProfit) : ''],
      ['30-day net', money(net30), sign(net30)],
      ['Cars in shop', s.wip.length + ' / ' + Math.round(s.parking * 1.7), s.wip.length >= s.parking ? 'neg' : '']
    ].map(function (r) {
      return '<div class="stat"><div class="k">' + r[0] + '</div><div class="v sm ' + r[2] + '">' + r[1] + '</div></div>';
    }).join('');

    var a = alerts(s).length;
    $('#tabs').innerHTML = TABS.map(function (t) {
      var pip = t.id === 'dash' && a ? '<span class="pip">' + a + '</span>' : '';
      return '<button data-act="tab" data-arg="' + t.id + '" class="' + (UI.tab === t.id ? 'on' : '') + '">' + t.name + pip + '</button>';
    }).join('');

    $('#btnEnd').textContent = s.gameOver ? 'Shop closed' : (s.dow === 6 ? 'Skip Sunday →' : 'Open the Shop →');
    $('#btnEnd').disabled = !!s.gameOver;
  }

  /* ----------------------------------------------------------- dashboard */
  function viewDash(s) {
    var last = s.history[s.history.length - 1];
    var h = '';

    var al = alerts(s);
    if (al.length) {
      h += '<div class="card" style="margin-bottom:14px"><h3>Needs your attention</h3>' +
        al.map(function (a) {
          return '<div class="alert ' + (a.k === 'warn' ? '' : a.k) + '">' + a.t +
            (a.act ? ' <button class="btn sm" data-act="' + a.act + '">Review</button>' : '') + '</div>';
        }).join('') + '</div>';
    }

    if (!last) {
      h += '<div class="card"><h3>Opening day</h3><p class="note">You have three bays, two technicians, one service writer, eight parking spaces and a bank loan. ' +
        'Set your prices at the Front Counter, decide what to spend on Marketing, then open the shop.</p>' +
        '<button class="btn" data-act="help">How this works</button></div>';
      return h;
    }

    var bn = E.bottleneck(s);
    if (bn) {
      h += '<div class="card" style="margin-bottom:14px;border-color:#4a4030">' +
        '<h3>Your binding constraint <span class="tag hot">' + bn.title + '</span></h3>' +
        '<p style="margin:0 0 6px;font-size:14.5px">' + bn.detail + '</p>' +
        '<p style="margin:0;color:var(--ink2);font-size:13.5px"><b>What to do:</b> ' + bn.fix + '</p></div>';
    }

    var kpis = [
      { k: 'Cars out', v: Math.round(last.cars), s: avgOf(s.history, 'cars', 30).toFixed(1) + '/day over 30' },
      { k: 'ARO', v: money(last.aro), s: 'avg ticket · ' + money(avgOf(s.history, 'aro', 30)) + ' /30d' },
      { k: 'Revenue', v: money(last.revenue), s: money(sumOf(s.history, 'revenue', 30)) + ' /30d' },
      { k: 'Net profit', v: money(last.netProfit), s: money(sumOf(s.history, 'netProfit', 30)) + ' /30d', cls: sign(last.netProfit) },
      { k: 'Billed hours', v: last.hours.toFixed(1), s: 'productivity ' + pct(last.productivity) },
      { k: 'Bay utilization', v: pct(last.bayUtil), s: s.bays.length + ' bays · ' + s.techs.length + ' techs' },
      { k: 'Close rate', v: pct(last.closeRate), s: Math.round(last.opportunities) + ' opportunities' },
      { k: 'CSI', v: last.csi === null ? '—' : Math.round(last.csi), s: 'reputation ' + Math.round(s.reputation) }
    ];
    h += '<div class="grid g4" style="margin-bottom:14px">' + kpis.map(function (k) {
      return '<div class="kpi"><div class="k">' + k.k + '</div><div class="v ' + (k.cls || '') + '">' + k.v + '</div><div class="s">' + k.s + '</div></div>';
    }).join('') + '</div>';

    h += '<div class="grid g2">';

    /* the board */
    h += '<div class="card"><h3>The board <span class="dim">' + s.wip.length + ' cars in the shop</span></h3>';
    if (!s.wip.length) h += '<p class="note">Every car went home. That is the goal.</p>';
    else {
      h += '<table><tr><th>Vehicle</th><th>Work</th><th class="num">Hrs left</th><th class="num">Days</th></tr>';
      h += s.wip.slice(0, 14).map(function (ro) {
        var left = ro.jobs.reduce(function (t, l) { return t + (l.done ? 0 : l.remaining); }, 0);
        var names = ro.jobs.map(function (l) { return (l.done ? '✓ ' : '') + D.JOB_BY_ID[l.jobId].name; }).join(', ');
        return '<tr><td>' + esc(ro.vehicle) + '<div class="dim" style="font-size:12px">' + esc(ro.customer) + (ro.comeback ? ' <span class="tag no">comeback</span>' : '') + '</div></td>' +
          '<td style="font-size:12.5px">' + esc(names) + '</td>' +
          '<td class="num mono">' + left.toFixed(1) + '</td>' +
          '<td class="num ' + (ro.daysInShop >= 2 ? 'neg' : '') + '">' + ro.daysInShop + '</td></tr>';
      }).join('');
      h += '</table>';
      if (s.wip.length > 14) h += '<p class="hint">+ ' + (s.wip.length - 14) + ' more</p>';
    }
    h += '</div>';

    /* trend */
    var rev = s.history.slice(-60).map(function (d) { return d.revenue; });
    var net = s.history.slice(-60).map(function (d) { return d.netProfit; });
    var nw = s.history.slice(-60).map(function (d) { return d.netWorth; });
    h += '<div class="card"><h3>Trend <span class="dim">last ' + Math.min(60, s.history.length) + ' days</span></h3>' +
      '<div class="dim" style="font-size:12px;margin-bottom:2px">Daily revenue</div>' + spark(rev, '#ffb020') +
      '<div class="dim" style="font-size:12px;margin:8px 0 2px">Daily net profit</div>' + spark(net, '#3ecf8e') +
      '<div class="dim" style="font-size:12px;margin:8px 0 2px">Net worth</div>' + spark(nw, '#57a6ff') +
      '</div>';

    h += '</div>';
    return h;
  }

  /* ------------------------------------------------------- front counter */
  function viewCounter(s) {
    var pi = E.priceIndex(s);
    var piLabel = pi < 0.92 ? 'Discount shop' : pi < 1.03 ? 'At market' : pi < 1.14 ? 'Slight premium' : pi < 1.28 ? 'Premium' : 'Highest in town';
    var piCls = pi < 1.14 ? 'pos' : pi < 1.28 ? 'warnc' : 'neg';

    var h = '<div class="grid g2">';

    h += '<div class="card"><h3>Pricing</h3>' +
      '<p class="note">The going rate in this town is ' + money(D.MARKET_LABOR_RATE) + '/hr and a ' + D.MARKET_MARKUP.toFixed(2) +
      'x parts matrix. Charging a premium works — right up until customers start feeling gouged and your reviews turn.</p>' +

      field('Labor rate', money(s.laborRate) + '/hr', 'range', 'laborRate', s.laborRate, 80, 280, 1,
        'You bill flat-rate book time, not clock time. A faster tech bills the same hours in less time.') +
      field('Parts matrix markup', s.partsMarkup.toFixed(2) + 'x', 'range', 'partsMarkup', s.partsMarkup, 1.2, 3.0, 0.05,
        'Parts gross profit at this markup: ' + pct(1 - 1 / s.partsMarkup) + '. Industry target is 45-52%.') +
      field('Diagnostic fee', money(s.diagFee) + '/hr', 'range', 'diagFee', s.diagFee, 0, 260, 5,
        'Charge nothing and you give away your most skilled labor. Charge too much and people shop the diagnosis.') +
      field('Oil change price', money(s.lofPrice), 'range', 'lofPrice', s.lofPrice, 19, 140, 1,
        'The classic loss leader. Cheap oil changes fill the lot with cars your inspection can sell work on.') +

      '<div class="row sb" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">' +
      '<span class="dim">Price position</span><b class="' + piCls + '">' + piLabel + ' · index ' + pi.toFixed(2) + '</b></div>' +
      '</div>';

    h += '<div class="card"><h3>Shop policy</h3>' +
      '<label class="field"><span class="lbl">Dispatch priority</span>' +
      '<select data-set="dispatch">' +
      opt('promise', s.dispatch, 'Promise time first — oldest cars out the door') +
      opt('profit', s.dispatch, 'Gross profit first — chase the big tickets') +
      opt('fifo', s.dispatch, 'First in, first out — strictly fair') +
      '</select><div class="hint">Promise-time protects your CSI. Profit-first makes more money per hour but strands small jobs and burns reputation.</div></label>' +

      field('Overtime', s.overtime.toFixed(1) + ' hrs/tech/day', 'range', 'overtime', s.overtime, 0, 3, 0.5,
        'Paid at time and a half. Adds capacity today, adds fatigue and comebacks tomorrow.') +

      '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">' +
      '<div class="split">' +
      '<div class="l">Bay capacity</div><div class="r">' + ((D.SHOP_HOURS + s.overtime) * s.bays.length).toFixed(0) + ' hrs/day</div>' +
      '<div class="l">Technician capacity</div><div class="r">' + ((D.SHOP_HOURS + s.overtime) * s.techs.length).toFixed(0) + ' hrs/day</div>' +
      '<div class="l">Writer capacity</div><div class="r">' + s.writers.reduce(function (t, w) { return t + E.writerStats(s, w).capacity; }, 0) + ' ROs/day</div>' +
      '<div class="l">Lot capacity</div><div class="r">' + Math.round(s.parking * 1.7) + ' cars/day</div>' +
      '</div><div class="hint">Your throughput is the smallest of these four. Money spent on anything else is wasted.</div></div>' +
      '</div>';

    h += '</div>';

    /* menu board */
    var ce = E.shopCerts(s);
    h += '<div class="card" style="margin-top:14px"><h3>Menu board <span class="dim">your price vs. the shop down the street</span></h3><table>' +
      '<tr><th>Job</th><th class="num">Book hrs</th><th class="num">Parts cost</th><th class="num">Your price</th><th class="num">Market</th><th class="num">GP</th><th>Status</th></tr>';
    h += D.JOBS.filter(function (j) { return !j.upsellOnly; }).slice(0, 26).map(function (j) {
      var mine = E.jobPrice(s, j);
      var mkt = (j.id === 'lof' ? 79 : j.cat === 'Diagnostics' ? 145 * j.hours : j.hours * D.MARKET_LABOR_RATE) + j.parts * D.MARKET_MARKUP;
      var gp = mine - j.parts;
      var can = E.canDoJob(s, j, ce);
      var why = '';
      if (!can) {
        if (!ce[j.cert]) why = 'No ' + D.CERTS[j.cert].short + ' tech';
        else {
          var m = E.missingEquipFor(s, j);
          why = 'Needs ' + (m && m.miss.length ? m.miss.map(function (x) { return D.EQUIPMENT[x].name; }).join(' + ') + ' in one bay' : 'equipment');
        }
      }
      return '<tr><td>' + j.name + '</td><td class="num mono">' + j.hours.toFixed(1) + '</td><td class="num mono">' + money(j.parts) + '</td>' +
        '<td class="num mono"><b>' + money(mine) + '</b></td><td class="num mono dim">' + money(mkt) + '</td>' +
        '<td class="num mono">' + pct(gp / mine) + '</td>' +
        '<td>' + (can ? '<span class="tag on">selling</span>' : '<span class="tag no">' + why + '</span>') + '</td></tr>';
    }).join('') + '</table></div>';

    return h;
  }

  function opt(v, cur, label) { return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + label + '</option>'; }
  function field(label, value, type, key, val, min, max, step, hint) {
    return '<label class="field"><span class="lbl">' + label + ' <b>' + value + '</b></span>' +
      '<input type="' + type + '" data-set="' + key + '" value="' + val + '" min="' + min + '" max="' + max + '" step="' + step + '">' +
      (hint ? '<div class="hint">' + hint + '</div>' : '') + '</label>';
  }

  /* ------------------------------------------------------------ bays */
  function viewBays(s) {
    var h = '<div class="card" style="margin-bottom:14px"><h3>Capacity</h3><div class="grid g4">' +
      kpi('Bays', s.bays.length, (D.SHOP_HOURS * s.bays.length) + ' bay-hours/day') +
      kpi('Parking spaces', s.parking, 'handles ~' + Math.round(s.parking * 1.7) + ' cars/day') +
      kpi('Next bay', money(D.BAY_COST(s.bays.length)), '+' + money(D.BAY_RENT_PER_DAY) + '/day rent') +
      kpi('Extra space', money(D.PARKING_COST), '+' + money(D.PARKING_RENT_PER_DAY) + '/day') +
      '</div><div class="row" style="margin-top:12px">' +
      '<button class="btn" data-act="buyBay">Build another bay — ' + money(D.BAY_COST(s.bays.length)) + '</button>' +
      '<button class="btn" data-act="buyParking" data-arg="2">Add 2 spaces — ' + money(D.PARKING_COST * 2) + '</button>' +
      '<button class="btn" data-act="buyParking" data-arg="6">Add 6 spaces — ' + money(D.PARKING_COST * 6) + '</button>' +
      '</div><p class="hint">A bay with no technician in it is a very expensive place to store air. Cars you cannot park are cars you never see.</p></div>';

    h += '<div class="grid g2">';
    h += s.bays.map(function (b) {
      var tl = D.TOOL_LEVELS[b.toolLevel - 1], nxt = D.TOOL_LEVELS[b.toolLevel];
      var installed = b.equip.map(function (e) { return '<span class="tag on">' + D.EQUIPMENT[e].name + '</span>'; }).join('');
      var avail = Object.keys(D.EQUIPMENT).filter(function (k) { return k !== 'lift' && b.equip.indexOf(k) < 0; });
      return '<div class="card"><h3>' + b.name + (s.day < b.downUntil ? ' <span class="tag no">down for repair</span>' : '') + '</h3>' +
        '<div class="row sb"><span class="dim">Tooling: <b style="color:var(--ink)">' + tl.name + '</b> (level ' + b.toolLevel + '/5)</span>' +
        '<span class="mono dim">' + pct(tl.speed - 1, 0) + ' faster · ' + pct(1 - tl.comeback, 0) + ' fewer comebacks</span></div>' +
        bar(b.toolLevel / 5) +
        (nxt ? '<button class="btn sm" style="margin-top:9px" data-act="upgradeTools" data-arg="' + b.id + '">Upgrade to ' + nxt.name + ' — ' + money(nxt.cost) + '</button>'
          : '<div class="hint" style="margin-top:9px">Fully tooled.</div>') +
        '<div style="margin-top:12px"><div class="dim" style="font-size:12px;margin-bottom:4px">Installed equipment</div>' + installed + '</div>' +
        (avail.length ? '<div class="row" style="margin-top:10px">' +
          '<select data-eqsel="' + b.id + '" style="flex:1">' + avail.map(function (k) {
            return '<option value="' + k + '">' + D.EQUIPMENT[k].name + ' — ' + money(D.EQUIPMENT[k].cost) + '</option>';
          }).join('') + '</select>' +
          '<button class="btn sm" data-act="buyEquip" data-arg="' + b.id + '">Install</button></div>' +
          '<div class="hint">' + D.EQUIPMENT[avail[0]].note + '</div>' : '') +
        '</div>';
    }).join('');
    h += '</div>';

    /* what you are losing */
    var last = UI.lastDay;
    var missed = last && last.missedJobs ? Object.keys(last.missedJobs) : [];
    if (missed.length) {
      h += '<div class="card" style="margin-top:14px"><h3>Work you had to turn down yesterday</h3><table>' +
        '<tr><th>Job</th><th class="num">Asked</th><th class="num">Ticket</th><th>What you need</th></tr>' +
        missed.sort(function (a, b) { return last.missedJobs[b] - last.missedJobs[a]; }).slice(0, 8).map(function (id) {
          var j = D.JOB_BY_ID[id], ce = E.shopCerts(s);
          var need = !ce[j.cert] ? 'A tech certified in ' + D.CERTS[j.cert].name
            : (function () { var m = E.missingEquipFor(s, j); return m.miss.map(function (x) { return D.EQUIPMENT[x].name; }).join(' + ') + ' in a single bay'; })();
          return '<tr><td>' + j.name + '</td><td class="num">' + last.missedJobs[id] + '</td><td class="num mono">' + money(E.jobPrice(s, j)) + '</td><td class="dim">' + need + '</td></tr>';
        }).join('') + '</table></div>';
    }
    return h;
  }

  function kpi(k, v, s2) { return '<div class="kpi"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + (s2 || '') + '</div></div>'; }

  /* ------------------------------------------------------------- crew */
  function viewCrew(s) {
    var h = '';
    var use = {}, bayUse = null;
    if (UI.lastDay && UI.lastDay.techUse) {
      UI.lastDay.techUse.forEach(function (u) { use[u.id] = u; });
      bayUse = UI.lastDay.bayUse;
    }
    var waiting = UI.lastDay && UI.lastDay.waiting ? UI.lastDay.waiting : null;
    if (waiting && Object.keys(waiting.cert).length) {
      h += '<div class="card" style="margin-bottom:14px"><h3>Sold work parked for want of a certification</h3>' +
        Object.keys(waiting.cert).map(function (c) {
          return '<div class="alert">' + waiting.cert[c].toFixed(1) + ' hours of ' + D.CERTS[c].name +
            ' work is sitting on the lot because nobody on the floor is certified for it.</div>';
        }).join('') + '</div>';
    }
    if (bayUse && bayUse.length) {
      h += '<div class="card" style="margin-bottom:14px"><h3>Yesterday\'s bay utilization</h3><table>' +
        '<tr><th>Bay</th><th class="num">Hours worked</th><th class="num">Available</th><th style="width:38%">Utilization</th></tr>' +
        bayUse.map(function (b) {
          return '<tr><td>' + b.name + '</td><td class="num mono">' + b.used.toFixed(1) + '</td>' +
            '<td class="num mono dim">' + b.cap.toFixed(1) + '</td><td>' + bar(b.used / b.cap, b.used / b.cap > 0.9 ? 'bad' : 'good') + '</td></tr>';
        }).join('') + '</table></div>';
    }

    h += '<div class="card" style="margin-bottom:14px"><h3>Technicians <span class="dim">' + s.techs.length + ' on the payroll</span></h3>';
    if (!s.techs.length) h += '<p class="note">Nobody is turning wrenches.</p>';
    h += '<div class="grid g2">' + s.techs.map(function (t) {
      var lv = D.TECH_LEVELS[t.level - 1], nxt = D.TECH_LEVELS[t.level];
      var eff = E.techEfficiency(s, t);
      var missing = Object.keys(D.CERTS).filter(function (c) { return t.certs.indexOf(c) < 0; });
      var busy = s.day < t.outUntil;
      return '<div class="entity">' +
        '<div class="row sb"><div><h4>' + esc(t.name) + '</h4><div class="sub">' + lv.title + ' · level ' + t.level + '/5 · ' + money(E.techWage(t)) + '/hr</div></div>' +
        '<div style="text-align:right"><div class="mono" style="font-size:18px;font-weight:700">' + eff.toFixed(2) + '</div><div class="sub">efficiency</div></div></div>' +
        (busy ? '<div class="alert info" style="margin:9px 0">In class: ' + t.training.name + ' — back day ' + t.outUntil + '</div>' : '') +
        (use[t.id] ? '<div style="margin:9px 0 0"><div class="row sb" style="font-size:12px"><span class="dim">Hours worked yesterday</span>' +
          '<span class="mono">' + use[t.id].used.toFixed(1) + ' / ' + use[t.id].cap.toFixed(1) + '</span></div>' +
          bar(use[t.id].used / use[t.id].cap, use[t.id].used / use[t.id].cap > 0.9 ? 'bad' : 'good') + '</div>' : '') +
        '<div style="margin:9px 0"><div class="row sb" style="font-size:12px"><span class="dim">Morale</span><span class="mono">' + Math.round(t.morale) + '</span></div>' +
        bar(t.morale / 100, t.morale < 40 ? 'bad' : t.morale > 70 ? 'good' : '') +
        '<div class="row sb" style="font-size:12px;margin-top:5px"><span class="dim">Fatigue</span><span class="mono">' + pct(t.fatigue) + '</span></div>' +
        bar(t.fatigue, t.fatigue > 0.7 ? 'bad' : '') + '</div>' +
        '<div>' + t.certs.map(function (c) { return '<span class="tag on">' + D.CERTS[c].short + '</span>'; }).join('') + '</div>' +
        (nxt ? '<div style="margin-top:9px"><div class="row sb" style="font-size:12px"><span class="dim">Experience toward ' + nxt.title + '</span><span class="mono">' + Math.round(t.xp) + '/' + nxt.xp + '</span></div>' + bar(t.xp / nxt.xp) + '</div>' : '') +
        '<div class="row wrap" style="margin-top:11px">' +
        (nxt ? '<button class="btn sm" data-act="promoteTech" data-arg="' + t.id + '"' + (t.xp < nxt.xp ? ' disabled' : '') + '>Promote — ' + money(D.TECH_PROMOTION_COST[t.level] * (s.upgrades.training_room ? 0.5 : 1)) + '</button>' : '') +
        '<button class="btn sm" data-act="raise" data-arg="' + t.id + '">Raise +$3/hr</button>' +
        '<button class="btn sm danger" data-act="fire" data-arg="' + t.id + '">Let go</button>' +
        '</div>' +
        (missing.length && !busy ? '<div class="row" style="margin-top:9px">' +
          '<select data-certsel="' + t.id + '" style="flex:1">' + missing.map(function (c) {
            var cost = D.CERTS[c].cost * (s.upgrades.training_room ? 0.5 : 1);
            return '<option value="' + c + '">' + D.CERTS[c].name + ' — ' + money(cost) + ', ' + Math.max(1, Math.round(D.CERTS[c].days * (s.upgrades.training_room ? 0.5 : 1))) + 'd</option>';
          }).join('') + '</select><button class="btn sm" data-act="trainCert" data-arg="' + t.id + '">Send to school</button></div>' : '') +
        '</div>';
    }).join('') + '</div></div>';

    h += '<div class="card" style="margin-bottom:14px"><h3>Service writers <span class="dim">' + s.writers.length + ' at the counter</span></h3>';
    h += '<div class="grid g2">' + s.writers.map(function (w) {
      var st = E.writerStats(s, w), lv = D.WRITER_LEVELS[w.level - 1], nxt = D.WRITER_LEVELS[w.level];
      var need = [0, 180, 520, 1150][w.level];
      var missing = Object.keys(D.SALES_COURSES).filter(function (c) { return w.courses.indexOf(c) < 0; });
      var busy = s.day < w.outUntil;
      return '<div class="entity">' +
        '<div class="row sb"><div><h4>' + esc(w.name) + '</h4><div class="sub">' + lv.title + ' · level ' + w.level + '/4 · ' + money(E.writerWage(w)) + '/hr</div></div>' +
        '<div style="text-align:right"><div class="mono" style="font-size:18px;font-weight:700">' + pct(st.close) + '</div><div class="sub">close rate</div></div></div>' +
        (busy ? '<div class="alert info" style="margin:9px 0">In class: ' + w.training.name + ' — back day ' + w.outUntil + '</div>' : '') +
        '<div class="split" style="margin:9px 0">' +
        '<div class="l">Upsell multiplier</div><div class="r mono">' + st.upsell.toFixed(2) + 'x</div>' +
        '<div class="l">Repair orders / day</div><div class="r mono">' + st.capacity + '</div>' +
        '<div class="l">CSI effect</div><div class="r mono">' + (st.csi >= 0 ? '+' : '') + st.csi.toFixed(0) + '</div>' +
        '</div>' +
        '<div>' + (w.courses.length ? w.courses.map(function (c) { return '<span class="tag hot">' + D.SALES_COURSES[c].name + '</span>'; }).join('') : '<span class="dim" style="font-size:12px">No advanced sales training.</span>') + '</div>' +
        (nxt ? '<div style="margin-top:9px"><div class="row sb" style="font-size:12px"><span class="dim">Toward ' + nxt.title + '</span><span class="mono">' + Math.round(w.xp) + '/' + need + '</span></div>' + bar(w.xp / need) + '</div>' : '') +
        '<div class="row wrap" style="margin-top:11px">' +
        (nxt ? '<button class="btn sm" data-act="promoteWriter" data-arg="' + w.id + '"' + (w.xp < need ? ' disabled' : '') + '>Promote — ' + money(D.WRITER_PROMOTION_COST[w.level]) + '</button>' : '') +
        '<button class="btn sm" data-act="raise" data-arg="' + w.id + '">Raise +$3/hr</button>' +
        '<button class="btn sm danger" data-act="fire" data-arg="' + w.id + '">Let go</button></div>' +
        (missing.length && !busy ? '<div class="row" style="margin-top:9px">' +
          '<select data-salesel="' + w.id + '" style="flex:1">' + missing.map(function (c) {
            var sc = D.SALES_COURSES[c], cost = sc.cost * (s.upgrades.training_room ? 0.5 : 1);
            return '<option value="' + c + '">' + sc.name + ' — ' + money(cost) + '</option>';
          }).join('') + '</select><button class="btn sm" data-act="salesCourse" data-arg="' + w.id + '">Enroll</button></div>' +
          '<div class="hint">' + D.SALES_COURSES[missing[0]].desc + '</div>' : '') +
        '</div>';
    }).join('') + '</div></div>';

    /* hiring */
    h += '<div class="card"><h3>Hiring board <span class="dim">refreshes every few days</span></h3><div class="grid g2">';
    h += s.candidates.techs.map(function (c) {
      return '<div class="entity"><div class="row sb"><div><h4>' + esc(c.name) + '</h4>' +
        '<div class="sub">' + D.TECH_LEVELS[c.level - 1].title + ' · wants ' + money(c.askWage) + '/hr</div></div>' +
        '<div style="text-align:right"><div class="mono" style="font-weight:700">' + D.TECH_LEVELS[c.level - 1].eff.toFixed(2) + '</div><div class="sub">efficiency</div></div></div>' +
        '<div style="margin:8px 0">' + c.certs.map(function (x) { return '<span class="tag on">' + D.CERTS[x].short + '</span>'; }).join('') + '</div>' +
        '<button class="btn sm" data-act="hireTech" data-arg="' + c.id + '">Hire — ' + money(c.signing) + ' signing bonus</button></div>';
    }).join('');
    h += s.candidates.writers.map(function (c) {
      return '<div class="entity"><div class="row sb"><div><h4>' + esc(c.name) + '</h4>' +
        '<div class="sub">' + D.WRITER_LEVELS[c.level - 1].title + ' · wants ' + money(c.askWage) + '/hr</div></div>' +
        '<div style="text-align:right"><div class="mono" style="font-weight:700">' + pct(D.WRITER_LEVELS[c.level - 1].close) + '</div><div class="sub">close rate</div></div></div>' +
        '<div style="margin:8px 0">' + (c.courses.map(function (x) { return '<span class="tag hot">' + D.SALES_COURSES[x].name + '</span>'; }).join('') || '<span class="dim" style="font-size:12px">No sales training</span>') + '</div>' +
        '<button class="btn sm" data-act="hireWriter" data-arg="' + c.id + '">Hire — ' + money(c.signing) + ' signing bonus</button></div>';
    }).join('');
    h += '</div></div>';

    return h;
  }

  /* ------------------------------------------------------------- parts */
  function viewParts(s) {
    var use30 = {};
    var h = '<div class="card" style="margin-bottom:14px"><h3>Parts inventory</h3>' +
      '<p class="note">Every night the shop reorders up to your stocking level at a jobber discount. Anything you do not have on the shelf when a job is written gets hot-shot from the dealer at a ' +
      pct(D.EMERGENCY_PREMIUM) + ' premium, and the car cannot start until the afternoon.</p>' +
      '<table><tr><th>Category</th><th class="num">On hand</th><th class="num">Incoming</th><th>Stocking level</th><th class="num">Lead time</th></tr>';
    h += Object.keys(D.PART_CATS).map(function (k) {
      var c = D.PART_CATS[k];
      var inc = s.incoming.filter(function (o) { return o.cat === k; }).reduce(function (t, o) { return t + o.amt; }, 0);
      var low = s.inventory[k] < s.stockTarget[k] * 0.35;
      return '<tr><td>' + c.name + '</td>' +
        '<td class="num mono ' + (low ? 'neg' : '') + '">' + money(s.inventory[k]) + '</td>' +
        '<td class="num mono dim">' + (inc ? money(inc) : '—') + '</td>' +
        '<td><input type="number" data-stock="' + k + '" value="' + Math.round(s.stockTarget[k]) + '" min="0" step="100" style="width:120px"></td>' +
        '<td class="num dim">' + (c.lead ? c.lead + ' day' + (c.lead > 1 ? 's' : '') : 'same day') + '</td></tr>';
    }).join('') + '</table>';
    var total = Object.keys(s.inventory).reduce(function (t, k) { return t + s.inventory[k]; }, 0);
    var carry = Object.keys(D.PART_CATS).reduce(function (t, k) { return t + s.inventory[k] * D.PART_CATS[k].carry; }, 0);
    h += '<div class="split" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)">' +
      '<div class="l">Inventory value</div><div class="r mono">' + money(total) + '</div>' +
      '<div class="l">Daily carrying cost</div><div class="r mono">' + money(carry, 2) + '</div>' +
      '<div class="l">Hot-shot parts yesterday</div><div class="r mono ' + (UI.lastDay && UI.lastDay.emergencyParts > 0 ? 'neg' : '') + '">' + money(UI.lastDay ? UI.lastDay.emergencyParts : 0) + '</div>' +
      '</div>';
    h += '<p class="hint">Stock too little and you pay the premium and lose a day. Stock too much and the money sits on a shelf costing you carrying charges.</p></div>';
    return h;
  }

  /* --------------------------------------------------------- marketing */
  function viewMarketing(s) {
    var mods = s.modifiers;
    var lead = E.computeLeads(s, mods);
    var totalSpend = D.CHANNELS.reduce(function (t, c) { return t + s.channels[c.id].spend; }, 0);
    var totalLeads = lead.adLeads;

    var h = '<div class="grid g4" style="margin-bottom:14px">' +
      kpi('Ad spend', money(totalSpend) + '/day', money(totalSpend * 30) + '/month') +
      kpi('Paid leads', totalLeads.toFixed(1) + '/day', totalLeads > 0 ? money(totalSpend / totalLeads) + ' per lead' : 'not advertising') +
      kpi('Organic + repeat', (lead.organic + lead.returns).toFixed(1) + '/day', Math.round(s.customerBase) + ' customers on the list') +
      kpi('Traffic quality', lead.intent.toFixed(2), lead.intent > 1.1 ? 'buying customers' : lead.intent < 0.9 ? 'price shoppers' : 'mixed') +
      '</div>';

    h += '<div class="grid g2">' + D.CHANNELS.map(function (c) {
      var st = s.channels[c.id];
      var locked = s.day < c.unlock;
      var ci = lead.byChannel[c.id];
      var needFleet = c.fleet && !E.hasFleetWriter(s);
      return '<div class="card"><h3>' + c.name +
        (locked ? '<span class="tag no">unlocks day ' + c.unlock + '</span>'
          : needFleet ? '<span class="tag no">needs a commercially trained writer</span>'
            : '<span class="tag ' + (st.spend > 0 ? 'on' : '') + '">' + (st.spend > 0 ? 'running' : 'off') + '</span>') + '</h3>' +
        '<p class="note">' + c.desc + '</p>' +
        (locked ? '' :
          '<label class="field"><span class="lbl">Daily budget <b>' + money(st.spend) + '</b></span>' +
          '<input type="range" data-ad="' + c.id + '" value="' + st.spend + '" min="0" max="' + c.cap + '" step="5"></label>' +
          '<div class="split">' +
          '<div class="l">Leads per day</div><div class="r mono">' + ci.leads.toFixed(2) + '</div>' +
          '<div class="l">Effective cost per lead</div><div class="r mono">' + (ci.leads > 0.01 ? money(st.spend / ci.leads) : '—') + '</div>' +
          '<div class="l">Traffic intent</div><div class="r mono">' + c.intent.toFixed(2) + 'x</div>' +
          '<div class="l">Awareness built up</div><div class="r mono">' + money(st.stock) + '</div>' +
          '</div>' + bar(Math.min(1, ci.leads / c.max)) +
          '<div class="hint">' + (c.decay > 0.85 ? 'Slow burn: takes ~' + Math.round(1 / (1 - c.decay)) + ' days to reach full effect, and keeps working after you stop.'
            : 'Fast response: effect lands within a day or two and disappears just as fast.') + '</div>') +
        '</div>';
    }).join('') + '</div>';

    h += '<div class="card" style="margin-top:14px"><h3>Where your cars came from</h3>' +
      '<table><tr><th>Source</th><th class="num">Leads/day</th><th class="num">Share</th><th class="num">Cost/day</th></tr>' +
      '<tr><td>Organic / reputation</td><td class="num mono">' + lead.organic.toFixed(1) + '</td><td class="num mono">' + pct(lead.organic / (lead.lambda || 1)) + '</td><td class="num dim">free</td></tr>' +
      '<tr><td>Repeat customers</td><td class="num mono">' + lead.returns.toFixed(1) + '</td><td class="num mono">' + pct(lead.returns / (lead.lambda || 1)) + '</td><td class="num dim">free</td></tr>' +
      D.CHANNELS.filter(function (c) { return s.channels[c.id].spend > 0; }).map(function (c) {
        return '<tr><td>' + c.name + '</td><td class="num mono">' + lead.byChannel[c.id].leads.toFixed(1) + '</td>' +
          '<td class="num mono">' + pct(lead.byChannel[c.id].leads / (lead.lambda || 1)) + '</td>' +
          '<td class="num mono">' + money(s.channels[c.id].spend) + '</td></tr>';
      }).join('') +
      '</table><p class="hint">Advertising only pays if you can actually service the cars. Check your turned-away count before you raise a budget.</p></div>';

    /* upgrades live here too — they are all growth investments */
    h += '<div class="card" style="margin-top:14px"><h3>Shop investments</h3><div class="grid g2">' +
      Object.keys(D.UPGRADES).map(function (k) {
        var u = D.UPGRADES[k], owned = !!s.upgrades[k];
        return '<div class="entity"><div class="row sb"><h4>' + u.name + '</h4>' + (owned ? '<span class="tag on">installed</span>' : '') + '</div>' +
          '<div class="sub" style="margin:6px 0">' + u.desc + '</div>' +
          (owned ? '<div class="dim" style="font-size:12px">' + money(u.upkeep) + '/day upkeep</div>'
            : '<button class="btn sm" data-act="buyUpgrade" data-arg="' + k + '">Buy — ' + money(u.cost) + ' (' + money(u.upkeep) + '/day)</button>') +
          '</div>';
      }).join('') + '</div></div>';

    return h;
  }

  /* ----------------------------------------------------------- reports */
  function viewReports(s) {
    var hist = s.history;
    if (!hist.length) return '<div class="card"><p class="note">No trading days yet.</p></div>';
    var n = Math.min(30, hist.length);
    var d = UI.lastDay;

    function pl(days, label) {
      var rev = sumOf(hist, 'revenue', days);
      var acc = UI.accum(s, days);
      return '<div class="card"><h3>' + label + '</h3><div class="split">' +
        '<div class="l">Labor sales</div><div class="r mono">' + money(acc.laborSales) + '</div>' +
        '<div class="l">Parts sales</div><div class="r mono">' + money(acc.partsSales) + '</div>' +
        '<div class="l tot">Total sales</div><div class="r mono tot">' + money(rev) + '</div>' +
        '<div class="l" style="margin-top:8px">Parts cost</div><div class="r mono" style="margin-top:8px">(' + money(acc.partsCost) + ')</div>' +
        '<div class="l">Technician labor</div><div class="r mono">(' + money(acc.techWages) + ')</div>' +
        '<div class="l">Sublet</div><div class="r mono">(' + money(acc.sublet) + ')</div>' +
        '<div class="l tot">Gross profit</div><div class="r mono tot ' + sign(acc.gp) + '">' + money(acc.gp) + ' · ' + pct(rev ? acc.gp / rev : 0) + '</div>' +
        '<div class="l" style="margin-top:8px">Service writers</div><div class="r mono" style="margin-top:8px">(' + money(acc.writerWages) + ')</div>' +
        '<div class="l">Rent, utilities, insurance, owner draw</div><div class="r mono">(' + money(acc.fixed) + ')</div>' +
        '<div class="l">Advertising</div><div class="r mono">(' + money(acc.adSpend) + ')</div>' +
        '<div class="l">Shop supplies, card fees, carrying</div><div class="r mono">(' + money(acc.other) + ')</div>' +
        '<div class="l">Debt service</div><div class="r mono">(' + money(acc.debtService) + ')</div>' +
        '<div class="l tot">Net profit</div><div class="r mono tot ' + sign(acc.net) + '">' + money(acc.net) + ' · ' + pct(rev ? acc.net / rev : 0) + '</div>' +
        '</div></div>';
    }

    var h = '<div class="grid g2" style="margin-bottom:14px">' + pl(1, 'Yesterday') + pl(30, 'Last 30 days') + '</div>';

    var bench = [
      ['Cars per day', avgOf(hist, 'cars', n).toFixed(1), '8 - 14', avgOf(hist, 'cars', n) >= 8],
      ['Average repair order', money(avgOf(hist, 'aro', n)), '$450 - $650', avgOf(hist, 'aro', n) >= 450],
      ['Billed hours per day', avgOf(hist, 'hours', n).toFixed(1), '6+ per tech', avgOf(hist, 'hours', n) >= s.techs.length * 6],
      ['Technician productivity', pct(avgOf(hist, 'productivity', n)), '85% - 100%', avgOf(hist, 'productivity', n) >= 0.85],
      ['Bay utilization', pct(avgOf(hist, 'bayUtil', n)), '75% - 90%', avgOf(hist, 'bayUtil', n) >= 0.75],
      ['Estimate close rate', pct(avgOf(hist, 'closeRate', n)), '60% - 75%', avgOf(hist, 'closeRate', n) >= 0.6],
      ['Customer satisfaction', Math.round(avgOf(hist, 'csi', n)), '88+', avgOf(hist, 'csi', n) >= 88],
      ['Comebacks per day', avgOf(hist, 'comebacks', n).toFixed(2), 'under 0.2', avgOf(hist, 'comebacks', n) < 0.2],
      ['Turned away per day', avgOf(hist, 'turnedAway', n).toFixed(1), '0', avgOf(hist, 'turnedAway', n) < 0.5],
      ['Jobs refused (no capability)', avgOf(hist, 'lostNoCapability', n).toFixed(1), '0', avgOf(hist, 'lostNoCapability', n) < 0.5]
    ];
    h += '<div class="card" style="margin-bottom:14px"><h3>Key numbers vs. industry benchmark <span class="dim">' + n + '-day average</span></h3>' +
      '<table><tr><th>Metric</th><th class="num">You</th><th class="num">Benchmark</th><th class="num">Status</th></tr>' +
      bench.map(function (b) {
        return '<tr><td>' + b[0] + '</td><td class="num mono">' + b[1] + '</td><td class="num dim">' + b[2] + '</td>' +
          '<td class="num">' + (b[3] ? '<span class="tag on">on target</span>' : '<span class="tag no">below</span>') + '</td></tr>';
      }).join('') + '</table></div>';

    h += '<div class="card"><h3>Balance sheet</h3><div class="split">' +
      '<div class="l">Cash</div><div class="r mono">' + money(s.cash) + '</div>' +
      '<div class="l">Parts inventory</div><div class="r mono">' + money(Object.keys(s.inventory).reduce(function (t, k) { return t + s.inventory[k]; }, 0)) + '</div>' +
      '<div class="l">Equipment &amp; leasehold</div><div class="r mono">' + money(E.netWorth(s) - s.cash - Object.keys(s.inventory).reduce(function (t, k) { return t + s.inventory[k]; }, 0) + s.loan.balance + s.credit.balance) + '</div>' +
      '<div class="l">Bank loan</div><div class="r mono neg">(' + money(s.loan.balance) + ')</div>' +
      '<div class="l">Line of credit</div><div class="r mono neg">(' + money(s.credit.balance) + ')</div>' +
      '<div class="l tot">Net worth</div><div class="r mono tot">' + money(E.netWorth(s)) + '</div>' +
      '</div><div class="row" style="margin-top:12px">' +
      '<input type="number" id="loanAmt" value="25000" step="5000" style="width:140px">' +
      '<button class="btn sm" data-act="borrow">Borrow</button>' +
      '<button class="btn sm" data-act="repay">Repay</button>' +
      '<span class="hint">Term loan at ' + pct(s.loan.rate, 1) + '. The bank caps you at $400,000.</span></div></div>';

    return h;
  }

  /* Sum the detailed financial fields the compact history does not keep. */
  UI.accum = function (s, days) {
    var arr = UI.dayDetails.slice(-days);
    var out = { laborSales: 0, partsSales: 0, partsCost: 0, techWages: 0, writerWages: 0, sublet: 0, fixed: 0, adSpend: 0, other: 0, debtService: 0, gp: 0, net: 0 };
    arr.forEach(function (d) {
      Object.keys(out).forEach(function (k) {
        if (k === 'gp') out.gp += d.gp || 0;
        else if (k === 'net') out.net += d.netProfit || 0;
        else out[k] += d[k] || 0;
      });
    });
    return out;
  };
  UI.dayDetails = [];

  /* ---------------------------------------------------------- day report */
  UI.dayReport = function (s, d) {
    var b = '';
    b += '<div class="grid g4" style="margin-bottom:14px">' +
      kpi('Cars delivered', Math.round(d.carsOut), Math.round(d.rosClosed) + ' repair orders written') +
      kpi('Sales', money(d.revenue), 'ARO ' + money(d.aro)) +
      kpi('Gross profit', money(d.gp), pct(d.gpPct)) +
      kpi('Net profit', money(d.netProfit), d.netProfit >= 0 ? 'in the black' : 'in the red') +
      '</div>';

    if (d.events.length || d.notes.length) {
      b += '<div class="card" style="margin-bottom:14px"><h3>What happened</h3>' +
        d.events.map(function (e) { return '<div class="alert ' + (e.bad ? 'bad' : 'good') + '"><b>' + e.name + '</b> — ' + e.text + '</div>'; }).join('') +
        d.notes.map(function (t) { return '<div class="alert info">' + t + '</div>'; }).join('') + '</div>';
    }

    var funnel = [
      ['Customers who called or walked in', Math.round(d.opportunities + d.turnedAway + d.lostNoCapability)],
      ['Turned away — lot was full', Math.round(d.turnedAway)],
      ['Refused — not equipped or certified', Math.round(d.lostNoCapability)],
      ['Estimates written', Math.round(d.rosOpened)],
      ['Declined the estimate', Math.round(d.declined)],
      ['Repair orders sold', Math.round(d.rosClosed)],
      ['Additional work found and sold', Math.round(d.upsellsSold) + ' of ' + Math.round(d.upsellsOffered) + ' offered']
    ];
    b += '<div class="grid g2">';
    b += '<div class="card"><h3>The funnel</h3><div class="split">' +
      funnel.map(function (f) { return '<div class="l">' + f[0] + '</div><div class="r mono">' + f[1] + '</div>'; }).join('') +
      '</div></div>';

    b += '<div class="card"><h3>Production</h3><div class="split">' +
      '<div class="l">Hours billed</div><div class="r mono">' + d.billedHours.toFixed(1) + '</div>' +
      '<div class="l">Hours available</div><div class="r mono">' + d.availableHours.toFixed(1) + '</div>' +
      '<div class="l">Productivity</div><div class="r mono">' + pct(d.productivity) + '</div>' +
      '<div class="l">Effective labor rate</div><div class="r mono">' + money(d.effectiveLaborRate) + '/hr</div>' +
      '<div class="l">Comebacks generated</div><div class="r mono ' + (d.comebacks ? 'neg' : '') + '">' + d.comebacks + '</div>' +
      '<div class="l">Cars left overnight</div><div class="r mono">' + d.carryover + '</div>' +
      '<div class="l">Customer satisfaction</div><div class="r mono">' + (d.csi === null ? '—' : Math.round(d.csi)) + '</div>' +
      '</div></div>';
    b += '</div>';

    if (d.invoices.length) {
      b += '<div class="card" style="margin-top:14px"><h3>Delivered today</h3><table>' +
        '<tr><th>Customer</th><th>Vehicle</th><th>Work</th><th class="num">Total</th></tr>' +
        d.invoices.slice(0, 12).map(function (i) {
          return '<tr><td>' + esc(i.customer) + '</td><td>' + esc(i.vehicle) + '</td>' +
            '<td style="font-size:12.5px">' + esc(i.lines.join(', ')) + '</td>' +
            '<td class="num mono">' + money(i.total) + '</td></tr>';
        }).join('') + '</table></div>';
    }

    UI.modal('Day ' + d.day + ' · ' + d.dow + ' · close of business', b,
      '<button class="btn primary" data-act="closeModal">Continue</button>');
  };

  /* --------------------------------------------------------------- help */
  UI.help = function () {
    UI.modal('Running an auto repair shop',
      '<p class="note">You bill <b>flat-rate book time</b>, not clock time. A brake job books at 1.6 hours whether your technician takes one hour or three. ' +
      'That single fact drives everything else in the shop.</p>' +
      '<div class="card" style="margin-bottom:12px"><h3>The four constraints</h3><div class="split">' +
      '<div class="l"><b>Parking spaces</b></div><div class="r">Cars you cannot park are customers who go elsewhere — permanently.</div>' +
      '<div class="l"><b>Bays &amp; tools</b></div><div class="r">A job runs in one bay. That single bay must hold every tool the job requires.</div>' +
      '<div class="l"><b>Technicians</b></div><div class="r">Certifications decide what you may sell; skill level decides how fast and how well.</div>' +
      '<div class="l"><b>Service writers</b></div><div class="r">They convert calls into repair orders and find the additional work. Untrained writers give away money.</div>' +
      '</div></div>' +
      '<div class="card" style="margin-bottom:12px"><h3>The levers</h3><div class="split">' +
      '<div class="l"><b>Labor rate</b></div><div class="r">Repairs are not optional, so demand is fairly inelastic near the market rate. A premium usually pays — until customers feel gouged and your reviews turn on you.</div>' +
      '<div class="l"><b>Parts matrix</b></div><div class="r">Same idea, and customers do compare parts prices.</div>' +
      '<div class="l"><b>Oil changes</b></div><div class="r">A loss leader. Cheap oil changes buy you inspections, and inspections are where the real work is found.</div>' +
      '<div class="l"><b>Advertising</b></div><div class="r">Search ads land tomorrow and stop when you stop paying. Radio and mail take weeks to build and keep working after you stop. Never buy traffic you have no capacity to serve.</div>' +
      '<div class="l"><b>Training</b></div><div class="r">Costs cash and takes the person off the floor for days, then pays back forever.</div>' +
      '</div></div>' +
      '<p class="note">Watch the <b>turned away</b> and <b>refused</b> counters on the day report. They tell you exactly which constraint is binding, and therefore where the next dollar should go.</p>',
      '<button class="btn primary" data-act="closeModal">Got it</button>');
  };

  /* -------------------------------------------------------------- render */
  UI.render = function () {
    var s = UI.S;
    renderHead(s);
    var v = $('#view');
    if (UI.tab === 'dash') v.innerHTML = viewDash(s);
    else if (UI.tab === 'counter') v.innerHTML = viewCounter(s);
    else if (UI.tab === 'bays') v.innerHTML = viewBays(s);
    else if (UI.tab === 'crew') v.innerHTML = viewCrew(s);
    else if (UI.tab === 'parts') v.innerHTML = viewParts(s);
    else if (UI.tab === 'marketing') v.innerHTML = viewMarketing(s);
    else if (UI.tab === 'reports') v.innerHTML = viewReports(s);
  };

  G.UI = UI;
})(window);
