/*
 * Rendering and interaction. One delegated click handler, one delegated input
 * handler, and a full re-render after anything that changes state.
 */
var AutoShop = globalThis.AutoShop || (globalThis.AutoShop = {});

(function (NS) {
  'use strict';

  var D = NS.DATA;
  var S = NS.State;
  var A = NS.Actions;

  var UI = NS.UI = {
    state: null,
    tab: 'dashboard',
    order: {},          // parts order draft, category -> dollars
    modal: null,
    toastTimer: null
  };

  /* ------------------------------------------------------------- formatting */

  function money(n, dp) {
    var neg = n < 0;
    var v = Math.abs(n);
    var s = dp ? v.toFixed(dp) : Math.round(v).toLocaleString();
    if (dp) s = Number(v.toFixed(dp)).toLocaleString(undefined, {
      minimumFractionDigits: dp, maximumFractionDigits: dp
    });
    return (neg ? '-$' : '$') + s;
  }
  function k(n) {
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (Math.abs(n) >= 10000) return Math.round(n / 1000) + 'k';
    return Math.round(n).toLocaleString();
  }
  function pct(n, dp) { return (n * 100).toFixed(dp === undefined ? 0 : dp) + '%'; }
  function hrs(n) { return n.toFixed(1) + 'h'; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function stars(rep) {
    var full = Math.floor(rep + 0.001);
    var half = rep - full >= 0.5;
    var out = '';
    for (var i = 0; i < 5; i++) {
      out += i < full ? '★' : (i === full && half ? '⯨' : '☆');
    }
    return out;
  }
  function sign(n) { return (n >= 0 ? '+' : '') + money(n); }
  function cls(n) { return n > 0 ? 'good' : (n < 0 ? 'bad' : 'muted'); }
  function bar(value, max, klass) {
    var w = Math.max(0, Math.min(1, max > 0 ? value / max : 0)) * 100;
    return '<div class="bar ' + (klass || '') + '"><span style="width:' + w.toFixed(1) + '%"></span></div>';
  }

  /* ------------------------------------------------------------------ shell */

  UI.boot = function (state) {
    UI.state = state;
    document.body.innerHTML = shell();
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    UI.render();
  };

  function shell() {
    return '<header class="topbar" id="topbar"></header>' +
      '<nav class="tabs" id="tabs"></nav>' +
      '<main id="view"></main>' +
      '<div id="modalHost"></div>' +
      '<div id="toastHost"></div>';
  }

  var TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'bays', label: 'Bays & Tools' },
    { id: 'crew', label: 'Crew' },
    { id: 'parts', label: 'Parts' },
    { id: 'marketing', label: 'Marketing' },
    { id: 'pricing', label: 'Pricing & Policy' },
    { id: 'money', label: 'Money' },
    { id: 'reports', label: 'Reports' }
  ];

  UI.render = function () {
    var s = UI.state;
    document.getElementById('topbar').innerHTML = renderTop(s);
    document.getElementById('tabs').innerHTML = renderTabs(s);
    var view = document.getElementById('view');
    var fn = {
      dashboard: viewDashboard, bays: viewBays, crew: viewCrew, parts: viewParts,
      marketing: viewMarketing, pricing: viewPricing, money: viewMoney, reports: viewReports
    }[UI.tab] || viewDashboard;
    view.innerHTML = fn(s);
    if (s.gameOver && !UI.modal) showGameOver();
  };

  function renderTop(s) {
    var nw = NS.Sim.netWorth(s);
    var w = D.WEATHER_BY_ID[s.weather];
    var tw = D.WEATHER_BY_ID[s.tomorrowWeather];
    return '' +
      '<div class="brand">' +
        '<span class="logo">' + esc(s.shopName) + '</span>' +
        '<span class="date">Day ' + s.day + ' &middot; ' + NS.Sim.dateLabel(s) + '</span>' +
      '</div>' +
      '<div class="stats">' +
        stat('Cash', '<span class="' + (s.cash < 2000 ? 'bad' : '') + '">' + money(s.cash) + '</span>') +
        stat('Net worth', money(nw)) +
        stat('Reputation', '<span class="stars">' + stars(s.reputation) + '</span> ' +
          '<span class="small muted">' + s.reputation.toFixed(2) + '</span>') +
        stat('Today', w.icon + ' ' + w.name) +
        stat('Tomorrow', '<span class="small">' + tw.icon + ' ' + tw.name + '</span>') +
        stat('On the lot', s.wip.length + ' / ' + s.parking.spaces) +
      '</div>' +
      '<button class="primary run" data-act="run">' +
        (NS.Sim.isOpenDay(s, s.day) ? '▶ Open the Shop' : '▶ Skip the Day') +
      '</button>' +
      '<button class="ghost sm" data-act="menu">☰</button>';
  }

  function stat(kk, v) {
    return '<div class="stat"><div class="k">' + kk + '</div><div class="v">' + v + '</div></div>';
  }

  function renderTabs(s) {
    var alerts = countAlerts(s);
    return TABS.map(function (t) {
      var n = alerts[t.id] || 0;
      return '<button class="' + (UI.tab === t.id ? 'on' : '') + '" data-act="tab:' + t.id + '">' +
        t.label + (n ? '<span class="badge">' + n + '</span>' : '') + '</button>';
    }).join('');
  }

  /* ------------------------------------------------------------------ alerts */

  function buildAlerts(s) {
    var out = [];
    var f = NS.Sim.forecast(s);

    s.pendingOffers.forEach(function (o) {
      out.push({ tab: 'crew', kind: 'info', text: o.text, offer: o });
    });

    s.bays.forEach(function (b) {
      if (b.downDays > 0) {
        out.push({ tab: 'bays', kind: 'bad',
          text: b.name + ' is down for ' + b.downDays + ' more day(s). Emergency repair is ' +
            money(450 * b.downDays) + '.' });
      }
    });

    var low = [];
    D.PART_CATEGORIES.forEach(function (c) {
      var d = f.partsDays[c.id];
      if (d.burn > 1 && d.days < 3) low.push(c.name + ' (' + d.days.toFixed(1) + 'd)');
    });
    if (low.length) {
      out.push({ tab: 'parts', kind: 'warn',
        text: 'Running out of parts: ' + low.join(', ') + '. Jobs stall on the lot when the shelf is empty.' });
    }

    if (!S.availableWriters(s).length) {
      out.push({ tab: 'crew', kind: 'bad', text: 'No service advisor at the counter today. Nothing gets sold.' });
    } else if (f.expectedCars > f.counterCapacity * 1.25) {
      out.push({ tab: 'crew', kind: 'warn',
        text: 'Expect about ' + Math.round(f.expectedCars) + ' opportunities but the counter can only work ' +
          Math.round(f.counterCapacity) + '. Calls will go unanswered.' });
    }

    if (!S.availableTechs(s).length && f.open) {
      out.push({ tab: 'crew', kind: 'bad', text: 'No technician in the building. Nothing gets fixed today.' });
    }

    s.techs.forEach(function (t) {
      if (t.morale < 0.42) {
        out.push({ tab: 'crew', kind: 'warn',
          text: t.name + ' has low morale (' + pct(t.morale) + '). A ' + D.TECH_TITLES[t.level - 1] +
            ' is worth about $' + D.TECH_WAGE[t.level] + '/hr; you pay $' + t.wage.toFixed(2) + '.' });
      }
    });

    if (f.bookedOutDays >= 4) {
      out.push({ tab: 'dashboard', kind: 'warn',
        text: 'Booked out ' + f.bookedOutDays + ' days. Customers who will not wait are going elsewhere.' });
    }

    if (s.wip.length >= s.parking.spaces) {
      out.push({ tab: 'bays', kind: 'bad',
        text: 'The lot is full with ' + s.wip.length + ' unfinished cars. You cannot take new work.' });
    }

    if (s.credit.balance > 0) {
      out.push({ tab: 'money', kind: 'warn',
        text: 'Carrying ' + money(s.credit.balance) + ' on the line of credit at ' +
          pct(s.credit.apr, 1) + ' APR.' });
    }

    var lastRep = s.lastReport;
    if (lastRep && lastRep.counter.noTooling >= 3) {
      out.push({ tab: 'bays', kind: 'info',
        text: 'Yesterday you turned away ' + lastRep.counter.noTooling +
          ' customers for work this shop is not equipped to do.' });
    }

    return out;
  }

  function countAlerts(s) {
    var counts = {};
    buildAlerts(s).forEach(function (a) {
      if (a.kind === 'bad' || a.kind === 'warn' || a.offer) {
        counts[a.tab] = (counts[a.tab] || 0) + 1;
      }
    });
    return counts;
  }

  /* --------------------------------------------------------------- dashboard */

  function viewDashboard(s) {
    var f = NS.Sim.forecast(s);
    var alerts = buildAlerts(s);
    var st = s.stats;
    var lastNet = s.lastReport ? s.lastReport.profit.net : 0;

    var html = '<div class="grid g2">';

    /* Today's plan */
    html += '<div class="panel"><header><h2>Today\'s Plan</h2>' +
      '<span class="sub">' + NS.Sim.dateLabel(s) + '</span></header>';
    if (!f.open) {
      html += '<div class="alert warn">The shop is closed today. Rent and insurance still run. ' +
        'You can open Saturdays from the Pricing &amp; Policy tab.</div>';
    }
    html += '<div class="kv"><span class="k">Expected opportunities</span><span class="v">' +
      f.expectedCars.toFixed(1) + '</span></div>' +
      '<div class="kv"><span class="k">Front-counter capacity</span><span class="v">' +
        Math.round(f.counterCapacity) + ' repair orders</span></div>' +
      '<div class="kv"><span class="k">Sellable hours today</span><span class="v">' +
        hrs(f.capacityBookHours) + ' <span class="small muted">(' +
        S.activeBays(s).length + ' bays / ' + S.availableTechs(s).length + ' techs at ' +
        pct(f.shopEfficiency) + ' eff)</span></span></div>' +
      '<div class="kv"><span class="k">Already committed</span><span class="v">' +
        hrs(f.wipHours) + ' carryover + ' + f.appointmentsToday + ' appointments</span></div>' +
      '<div class="kv"><span class="k">Booked out</span><span class="v">' +
        (f.bookedOutDays === 0 ? 'Taking same-day work' : f.bookedOutDays + ' day(s)') + '</span></div>' +
      '<div class="kv"><span class="k">Lot</span><span class="v">' + f.lotUsed + ' / ' +
        f.lot + ' spaces</span></div>' +
      '<div class="kv"><span class="k">Break-even today</span><span class="v">' +
        money(f.breakEven) + '</span></div>';
    html += '</div>';

    /* Alerts */
    html += '<div class="panel"><header><h2>Owner\'s Desk</h2><span class="sub">' +
      alerts.length + ' item(s)</span></header><div class="col">';
    if (!alerts.length) {
      html += '<div class="alert good">Nothing on fire. Good time to invest in something.</div>';
    }
    alerts.slice(0, 8).forEach(function (a) {
      html += '<div class="alert ' + a.kind + '"><div>' + esc(a.text);
      if (a.offer) {
        html += '<div class="row" style="margin-top:6px">' +
          '<button class="sm primary" data-act="offer:' + a.offer.id + ':yes">Accept</button>' +
          '<button class="sm" data-act="offer:' + a.offer.id + ':no">Pass</button></div>';
      }
      html += '</div></div>';
    });
    html += '</div></div>';
    html += '</div>';

    /* Appointment book */
    html += '<div class="panel" style="margin-top:14px"><header><h2>The Book</h2>' +
      '<span class="sub">sold hours against sellable hours</span></header><div class="book">';
    f.book.forEach(function (d) {
      var pctFull = d.capacity > 0 ? d.booked / d.capacity : 0;
      var klass = pctFull > 0.95 ? 'bad' : (pctFull > 0.8 ? 'warn' : 'good');
      html += '<div class="day' + (d.open ? '' : ' closed') + (d.day === s.day ? ' today' : '') + '">' +
        '<div class="dn">' + d.dow.slice(0, 3) + (d.day === s.day ? ' •' : '') + '</div>' +
        '<div class="hrs">' + (d.open ? d.booked.toFixed(1) + '/' + d.capacity.toFixed(1) : '—') + '</div>' +
        (d.open ? bar(d.booked, d.capacity, klass) : '') +
        '<div class="cars">' + (d.open ? d.cars + ' cars' : 'closed') + '</div>' +
        '</div>';
    });
    html += '</div></div>';

    /* KPI tiles */
    html += '<div class="grid g4" style="margin-top:14px">' +
      tile('Revenue / 30 days', money(st.revenue30 || 0), 'gross profit ' + pct(st.gpPct30)) +
      tile('Average repair order', money(st.aro30), 'industry target $350-500') +
      tile('Closing ratio', pct(st.closeRate30), 'estimates that became work') +
      tile('Tech efficiency', pct(st.efficiency30), 'billed hours / clock hours') +
      tile('Cars / 30 days', Math.round(st.carCount30), (st.carCount30 / 30).toFixed(1) + ' per day') +
      tile('Yesterday\'s net', '<span class="' + cls(lastNet) + '">' + sign(lastNet) + '</span>',
        s.lastReport ? s.lastReport.dateLabel : 'not open yet') +
      tile('Retained customers', Math.round(s.customers.retained), 'people who come back') +
      tile('Fleet accounts', s.fleetAccounts.length,
        s.fleetAccounts.reduce(function (a, x) { return a + x.vehicles; }, 0) + ' vehicles') +
      '</div>';

    /* Trend + log */
    html += '<div class="grid g2" style="margin-top:14px">';
    html += '<div class="panel"><header><h2>Trend</h2><span class="sub">last 60 days</span></header>' +
      spark(s.history.slice(-60), 'netWorth', '#ff8a3d') +
      '<div class="legend"><span><i style="background:#ff8a3d"></i>Net worth</span>' +
      '<span><i style="background:#5aa9e6"></i>Cash</span>' +
      '<span><i style="background:#4ec97f"></i>Daily net</span></div>' +
      spark(s.history.slice(-60), 'cash', '#5aa9e6') +
      spark(s.history.slice(-60), 'profit', '#4ec97f', true) +
      '</div>';
    html += '<div class="panel"><header><h2>Shop Log</h2></header>' + logList(s, 14) + '</div>';
    html += '</div>';

    return html;
  }

  function tile(kk, v, sub) {
    return '<div class="tile"><div class="k">' + kk + '</div><div class="v">' + v + '</div>' +
      (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
  }

  function logList(s, n) {
    var items = s.log.slice(0, n);
    if (!items.length) return '<p class="muted small">Nothing has happened yet.</p>';
    return '<div class="log">' + items.map(function (e) {
      return '<div class="entry ' + e.kind + '"><span class="d">d' + e.day + '</span>' +
        '<span class="t">' + esc(e.text) + '</span></div>';
    }).join('') + '</div>';
  }

  /** Tiny inline SVG sparkline; zero dependencies, scales to the panel. */
  function spark(hist, key, color, zeroLine) {
    if (hist.length < 2) return '<div class="small dim" style="padding:8px 0">Not enough history yet.</div>';
    var vals = hist.map(function (d) { return d[key]; });
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    if (zeroLine) { min = Math.min(min, 0); max = Math.max(max, 0); }
    if (max - min < 1) max = min + 1;
    var w = 300, hh = 54;
    var pts = vals.map(function (v, i) {
      var x = (i / (vals.length - 1)) * w;
      var y = hh - ((v - min) / (max - min)) * (hh - 6) - 3;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var zero = '';
    if (zeroLine) {
      var zy = hh - ((0 - min) / (max - min)) * (hh - 6) - 3;
      zero = '<line x1="0" y1="' + zy.toFixed(1) + '" x2="' + w + '" y2="' + zy.toFixed(1) +
        '" stroke="#3a4757" stroke-dasharray="3 3" stroke-width="1"/>';
    }
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + hh + '" preserveAspectRatio="none">' +
      zero + '<polyline fill="none" stroke="' + color + '" stroke-width="1.6" points="' + pts + '"/>' +
      '</svg>';
  }

  /* -------------------------------------------------------------------- bays */

  function viewBays(s) {
    var html = '<div class="panel"><header><h2>Shop Floor</h2><span class="sub">' +
      S.activeBays(s).length + ' of ' + s.bays.length + ' bays working &middot; lot holds ' +
      s.parking.spaces + ' cars</span></header>' +
      '<p class="small muted">A bay can only do work its own tools support. Better tools do the ' +
      'same job in less time, which is the only way to bill more hours than you pay for.</p>' +
      '<div class="row wrap">' +
      '<button data-act="bay:build">Build a bay &middot; ' +
        money(Math.round(D.CONFIG.bayBuildCost * (1 + s.bays.length * 0.06))) + '</button>' +
      '<button data-act="park:1">Pave 1 parking space &middot; ' + money(D.CONFIG.parkingSpaceCost) + '</button>' +
      '<button data-act="park:4">Pave 4 spaces &middot; ' + money(D.CONFIG.parkingSpaceCost * 4) + '</button>' +
      '</div></div>';

    html += '<div class="grid g3" style="margin-top:14px">';
    s.bays.forEach(function (b) {
      html += renderBay(s, b);
    });
    html += '</div>';

    /* What the shop is currently unable to sell. */
    var missing = missingCapability(s);
    if (missing.length) {
      html += '<div class="panel" style="margin-top:14px"><header><h2>Work You Cannot Take</h2>' +
        '<span class="sub">jobs no bay is equipped for</span></header><table><thead><tr>' +
        '<th>Service</th><th>Missing</th><th class="r">Typical ticket</th>' +
        '<th class="r">Share of demand</th></tr></thead><tbody>';
      missing.forEach(function (m) {
        html += '<tr><td>' + esc(m.name) + '</td><td class="small muted">' + esc(m.missing) +
          '</td><td class="r">' + money(m.ticket) + '</td><td class="r">' + pct(m.share, 1) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    html += '<div class="panel" style="margin-top:14px"><header><h2>Shop Upgrades</h2>' +
      '<span class="sub">building-wide, not per bay</span></header><div class="grid g3">';
    D.UPGRADES.forEach(function (u) {
      var tier = S.upgradeTier(s, u.id);
      var next = u.tiers[tier];
      html += '<div class="card"><header><div><h3>' + esc(u.name) + '</h3>' +
        '<div class="tiny muted">' + esc(u.desc) + '</div></div>' +
        '<span class="pill ' + (tier ? 'on' : '') + '">' + (tier ? 'Tier ' + tier : 'None') + '</span>' +
        '</header>';
      if (tier) {
        html += '<div class="tiny good">Installed: ' + esc(u.tiers[tier - 1].label) + '</div>';
      }
      if (next) {
        html += '<div class="row between" style="margin-top:7px">' +
          '<span class="small">' + esc(next.label) + '<br><span class="tiny dim">' +
          esc(effectText(next)) + '</span></span>' +
          '<button class="sm" data-act="up:' + u.id + '">' + money(next.cost) + '</button></div>';
      } else {
        html += '<div class="tiny dim" style="margin-top:6px">Fully upgraded.</div>';
      }
      html += '</div>';
    });
    html += '</div></div>';
    return html;
  }

  function effectText(t) {
    var parts = [];
    var labels = {
      traffic: 'walk-ins/day', csi: 'satisfaction', close: 'closing ratio', upsell: 'upsell rate',
      writerCapacity: 'RO capacity', efficiency: 'tech efficiency', leadConv: 'lead conversion',
      repGain: 'reputation', majorClose: 'big-job close', capacity: 'parts capacity',
      trainingDiscount: 'training cost', moraleGain: 'morale', partsDiscount: 'parts cost',
      trust: 'trust', shrink: 'shrink'
    };
    for (var kk in t) {
      if (kk === 'cost' || kk === 'label') continue;
      if (kk === 'upkeep') { parts.push(money(t[kk]) + '/day upkeep'); continue; }
      var v = t[kk];
      var str = kk === 'capacity' ? '+' + money(v) : (Math.abs(v) < 1 ? (v > 0 ? '+' : '') + pct(v) : (v > 0 ? '+' : '') + v);
      parts.push(str + ' ' + (labels[kk] || kk));
    }
    return parts.join(', ');
  }

  function renderBay(s, b) {
    var down = b.downDays > 0;
    var html = '<div class="card' + (down ? ' down' : '') + '"><header><div><h3>' + esc(b.name) + '</h3>' +
      '<div class="tiny muted">' + capabilitySummary(s, b) + '</div></div>' +
      '<span class="pill ' + (down ? 'bad' : (b.active ? 'good' : '')) + '">' +
      (down ? 'Down ' + b.downDays + 'd' : (b.active ? 'Open' : 'Closed')) + '</span></header>';
    D.TOOL_ORDER.forEach(function (tid) {
      var tool = D.TOOLS[tid];
      var lvl = b.tools[tid] || 0;
      var next = tool.levels[lvl + 1];
      html += '<div class="toolrow"><div><div class="name">' + esc(tool.name) + '</div>' +
        '<div class="lvl">' + esc(tool.levels[lvl].label) +
        (lvl > 0 ? ' &middot; ' + Math.round(tool.levels[lvl].speed * 100) + '% speed' : '') +
        '</div></div>' +
        '<div class="tiny dim">' + (next ? esc(next.label) : 'max') + '</div>' +
        (next ? '<button class="sm" data-act="tool:' + b.id + ':' + tid + '">' +
          money(next.cost) + '</button>' : '<span class="tiny dim">—</span>') +
        '</div>';
    });
    html += '<div class="row" style="margin-top:9px">';
    if (down) html += '<button class="sm" data-act="bay:repair:' + b.id + '">Repair now &middot; ' +
      money(450 * b.downDays) + '</button>';
    html += '<button class="sm ghost" data-act="bay:toggle:' + b.id + '">' +
      (b.active ? 'Mothball' : 'Reopen') + '</button></div>';
    html += '</div>';
    return html;
  }

  function capabilitySummary(s, b) {
    var can = D.JOBS.filter(function (j) { return NS.Sim.bayCanDo(b, j); });
    var weight = can.reduce(function (a, j) { return a + j.weight; }, 0);
    var total = D.JOBS.reduce(function (a, j) { return a + j.weight; }, 0);
    return can.length + ' of ' + D.JOBS.length + ' services &middot; ' +
      pct(weight / total) + ' of incoming work';
  }

  function missingCapability(s) {
    var total = D.JOBS.reduce(function (a, j) { return a + j.weight; }, 0);
    var out = [];
    D.JOBS.forEach(function (j) {
      if (NS.Sim.shopCanDo(s, j)) return;
      var missing = [];
      for (var t in (j.requires || {})) {
        if (!j.requires[t]) continue;
        var have = S.activeBays(s).some(function (b) { return (b.tools[t] || 0) >= j.requires[t]; });
        if (!have) missing.push(D.TOOLS[t].levels[j.requires[t]].label);
      }
      out.push({
        name: j.name,
        missing: missing.join(' + ') || 'a capable bay',
        ticket: NS.Sim.fairPrice(s, j),
        share: j.weight / total
      });
    });
    return out.sort(function (a, b) { return b.share - a.share; });
  }

  /* -------------------------------------------------------------------- crew */

  function viewCrew(s) {
    var html = '';

    if (s.pendingOffers.length) {
      html += '<div class="panel" style="margin-bottom:14px"><header><h2>Decisions</h2></header><div class="col">';
      s.pendingOffers.forEach(function (o) {
        html += '<div class="alert warn"><div>' + esc(o.text) +
          '<div class="row" style="margin-top:6px">' +
          '<button class="sm primary" data-act="offer:' + o.id + ':yes">Accept</button>' +
          '<button class="sm" data-act="offer:' + o.id + ':no">Decline</button></div></div></div>';
      });
      html += '</div></div>';
    }

    html += '<div class="panel"><header><h2>Technicians</h2><span class="sub">' +
      s.techs.length + ' on payroll &middot; ' +
      money(s.techs.reduce(function (a, t) { return a + t.wage * s.policy.shiftHours; }, 0)) +
      '/day in wages</span></header><div class="grid g3">';
    if (!s.techs.length) html += '<p class="muted">Nobody is turning wrenches.</p>';
    s.techs.forEach(function (t) { html += renderTech(s, t); });
    html += '</div></div>';

    html += '<div class="panel" style="margin-top:14px"><header><h2>Service Advisors</h2>' +
      '<span class="sub">the counter decides what gets sold</span></header><div class="grid g3">';
    if (!s.writers.length) html += '<p class="bad">No advisor. Nothing gets quoted or sold.</p>';
    s.writers.forEach(function (w) { html += renderWriter(s, w); });
    html += '</div></div>';

    html += '<div class="panel" style="margin-top:14px"><header><h2>Hiring Board</h2>' +
      '<span class="sub">refreshes weekly</span>' +
      '<button class="sm" data-act="recruit">New applicants &middot; $900</button></header>' +
      '<div class="grid g3">';
    s.candidates.techs.forEach(function (c) { html += renderCandidate(s, c, 'tech'); });
    s.candidates.writers.forEach(function (c) { html += renderCandidate(s, c, 'writer'); });
    html += '</div></div>';
    return html;
  }

  function statusPill(p) {
    if (p.trainingDaysLeft > 0) {
      return '<span class="pill warn">In class ' + p.trainingDaysLeft + 'd</span>';
    }
    if (p.outDays > 0) return '<span class="pill bad">Out ' + p.outDays + 'd</span>';
    return '<span class="pill good">On the clock</span>';
  }

  function renderTech(s, t) {
    var prog = S.xpProgress(t.xp);
    var market = D.TECH_WAGE[t.level];
    var underpaid = t.wage < market * 0.95;
    var html = '<div class="card"><header><div><h3>' + esc(t.name) + '</h3>' +
      '<div class="tiny muted">' + D.TECH_TITLES[t.level - 1] + ' &middot; level ' + t.level + '</div>' +
      '</div>' + statusPill(t) + '</header>';
    html += '<div class="row wrap" style="gap:4px;margin-bottom:7px">';
    if (!t.specialties.length) html += '<span class="pill">generalist</span>';
    t.specialties.forEach(function (sp) { html += '<span class="pill on">' + sp + '</span>'; });
    t.courses.forEach(function (c) {
      var course = D.TECH_TRAINING.filter(function (x) { return x.id === c; })[0];
      if (course) html += '<span class="pill good" title="' + esc(course.name) + '">✓ ' +
        esc(course.name.split(' ')[0]) + '</span>';
    });
    html += '</div>';
    html += '<div class="kv"><span class="k">Wage</span><span class="v ' + (underpaid ? 'warn' : '') +
      '">$' + t.wage.toFixed(2) + '/hr <span class="tiny dim">market $' + market + '</span></span></div>';
    html += '<div class="small muted" style="margin-top:6px">Morale ' + pct(t.morale) + '</div>' +
      bar(t.morale, 1, t.morale < 0.45 ? 'bad' : (t.morale < 0.65 ? 'warn' : 'good'));
    html += '<div class="small muted" style="margin-top:5px">Fatigue ' + pct(t.fatigue) + '</div>' +
      bar(t.fatigue, 1, t.fatigue > 0.6 ? 'bad' : 'info');
    html += '<div class="small muted" style="margin-top:5px">Level progress ' +
      (prog.next ? Math.round(t.xp) + ' / ' + prog.next + ' xp' : 'maxed') + '</div>' +
      bar(prog.pct, 1, 'info');
    html += '<div class="row" style="margin-top:9px;gap:6px">' +
      '<select data-course="tech:' + t.id + '">' + courseOptions(s, t, D.TECH_TRAINING) + '</select>' +
      '<button class="sm" data-act="train:tech:' + t.id + '">Enroll</button></div>';
    html += '<div class="row" style="margin-top:6px;gap:6px">' +
      '<button class="sm" data-act="raise:tech:' + t.id + '">+$2/hr raise</button>' +
      '<button class="sm danger" data-act="fire:tech:' + t.id + '">Let go</button></div>';
    return html + '</div>';
  }

  function renderWriter(s, w) {
    var prog = S.xpProgress(w.xp);
    var html = '<div class="card"><header><div><h3>' + esc(w.name) + '</h3>' +
      '<div class="tiny muted">Advisor &middot; level ' + w.level + '</div></div>' +
      statusPill(w) + '</header>';
    html += '<div class="row wrap" style="gap:4px;margin-bottom:7px">';
    w.courses.forEach(function (c) {
      var course = D.WRITER_TRAINING.filter(function (x) { return x.id === c; })[0];
      if (course) html += '<span class="pill good">✓ ' + esc(course.name.split(' ')[0]) + '</span>';
    });
    html += '</div>';
    html += '<div class="kv"><span class="k">Salary</span><span class="v">' + money(w.salary) + '/day</span></div>' +
      '<div class="kv"><span class="k">Repair orders/day</span><span class="v">' +
        Math.round(NS.Sim.writerCapacity(s, w)) + '</span></div>' +
      '<div class="kv"><span class="k">Closing skill</span><span class="v">' +
        (NS.Sim.writerClose(s, w) >= 0 ? '+' : '') + pct(NS.Sim.writerClose(s, w), 1) + '</span></div>' +
      '<div class="kv"><span class="k">Upsell rate</span><span class="v">' +
        pct(NS.Sim.writerUpsell(s, w)) + '</span></div>';
    html += '<div class="small muted" style="margin-top:6px">Level progress</div>' + bar(prog.pct, 1, 'info');
    html += '<div class="row" style="margin-top:9px;gap:6px">' +
      '<select data-course="writer:' + w.id + '">' + courseOptions(s, w, D.WRITER_TRAINING) + '</select>' +
      '<button class="sm" data-act="train:writer:' + w.id + '">Enroll</button></div>';
    html += '<div class="row" style="margin-top:6px;gap:6px">' +
      '<button class="sm" data-act="raise:writer:' + w.id + '">+$15/day raise</button>' +
      '<button class="sm danger" data-act="fire:writer:' + w.id + '">Let go</button></div>';
    return html + '</div>';
  }

  function courseOptions(s, person, catalog) {
    var opts = catalog.filter(function (c) { return person.courses.indexOf(c.id) < 0; });
    if (!opts.length) return '<option value="">All courses complete</option>';
    return opts.map(function (c) {
      var cost = Math.round(c.cost * (1 - S.upgradeEffect(s, 'trainingDiscount')));
      var blocked = c.minLevel && person.level < c.minLevel;
      return '<option value="' + c.id + '"' + (blocked ? ' disabled' : '') + '>' +
        esc(c.name) + ' — ' + money(cost) + ', ' + c.days + 'd' +
        (blocked ? ' (needs L' + c.minLevel + ')' : '') + '</option>';
    }).join('');
  }

  function renderCandidate(s, c, kind) {
    var isTech = kind === 'tech';
    var cost = c.signingBonus + (isTech ? 400 : 300);
    var html = '<div class="card"><header><div><h3>' + esc(c.name) + '</h3>' +
      '<div class="tiny muted">' + (isTech ? D.TECH_TITLES[c.level - 1] : 'Service Advisor') +
      ' &middot; level ' + c.level + '</div></div>' +
      '<span class="pill">' + (isTech ? 'Tech' : 'Advisor') + '</span></header>';
    if (isTech) {
      html += '<div class="row wrap" style="gap:4px;margin-bottom:6px">';
      if (!c.specialties.length) html += '<span class="pill">generalist</span>';
      c.specialties.forEach(function (sp) { html += '<span class="pill on">' + sp + '</span>'; });
      html += '</div>';
      html += '<div class="kv"><span class="k">Wants</span><span class="v">$' + c.wage.toFixed(2) + '/hr</span></div>' +
        '<div class="kv"><span class="k">Cost/day at ' + s.policy.shiftHours + 'h</span><span class="v">' +
        money(c.wage * s.policy.shiftHours * 1.098) + '</span></div>';
    } else {
      html += '<div class="kv"><span class="k">Wants</span><span class="v">' + money(c.salary) + '/day</span></div>' +
        '<div class="kv"><span class="k">Repair orders/day</span><span class="v">' +
        Math.round(NS.Sim.writerCapacity(s, c)) + '</span></div>';
    }
    html += '<div class="kv"><span class="k">Up front</span><span class="v">' + money(cost) + '</span></div>';
    html += '<button class="sm primary" style="margin-top:8px;width:100%" data-act="hire:' + kind +
      ':' + c.id + '">Hire ' + esc(c.name.split(' ')[0]) + '</button>';
    return html + '</div>';
  }

  /* ------------------------------------------------------------------- parts */

  function viewParts(s) {
    var f = NS.Sim.forecast(s);
    var invValue = S.inventoryValue(s);
    var cap = S.inventoryCapacity(s);
    var orderTotal = 0;
    for (var kk in UI.order) orderTotal += UI.order[kk] || 0;
    var tier = A.bulkDiscount(orderTotal);
    var discount = tier.discount + S.upgradeEffect(s, 'partsDiscount');

    var html = '<div class="grid g2">';
    html += '<div class="panel"><header><h2>Stock Room</h2><span class="sub">' +
      money(invValue) + ' of ' + money(cap) + ' capacity</span></header>' +
      bar(invValue, cap, invValue / cap > 0.9 ? 'warn' : 'info') +
      '<p class="small muted" style="margin-top:9px">Parts are ordered at cost and consumed by ' +
      'repair orders. Empty shelves mean the car sits on your lot waiting for the truck, which ' +
      'costs a day of satisfaction. Same-day emergency parts cost ' +
      pct(D.CONFIG.emergencyPartsPremium) + ' extra.</p>' +
      '<div class="row wrap" style="margin-top:8px">' +
      '<button class="sm" data-act="stock:5">Stock to 5 days</button>' +
      '<button class="sm" data-act="stock:10">Stock to 10 days</button>' +
      '<button class="sm" data-act="stock:20">Stock to 20 days</button>' +
      '</div></div>';

    html += '<div class="panel"><header><h2>Order Summary</h2></header>' +
      '<div class="kv"><span class="k">Order value</span><span class="v">' + money(orderTotal) + '</span></div>' +
      '<div class="kv"><span class="k">' + (orderTotal > 0 ? esc(tier.label) : 'Bulk discount') +
        '</span><span class="v ' + (discount > 0 ? 'good' : 'muted') + '">' +
        (orderTotal > 0 ? '-' + pct(discount, 1) : '—') + '</span></div>' +
      '<div class="kv"><span class="k">You pay</span><span class="v">' +
        money(orderTotal * (1 - discount)) + '</span></div>' +
      '<div class="kv"><span class="k">Arrives</span><span class="v">tomorrow morning</span></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="primary" data-act="order"' + (orderTotal <= 0 ? ' disabled' : '') + '>Place order</button>' +
      '<button class="ghost sm" data-act="clearorder">Clear</button></div>' +
      '<div class="small muted" style="margin-top:9px">Bulk tiers: ' +
      D.BULK_TIERS.filter(function (t) { return t.min > 0; }).map(function (t) {
        return money(t.min) + '+ = -' + pct(t.discount, 1);
      }).join(' &middot; ') + '</div></div>';
    html += '</div>';

    html += '<div class="panel" style="margin-top:14px"><header><h2>Inventory</h2>' +
      '<span class="sub">burn rate from the last two weeks</span></header>' +
      '<table><thead><tr><th>Category</th><th class="r">On hand</th><th class="r">Burn/day</th>' +
      '<th class="r">Days left</th><th class="r">Supplier index</th><th class="r" style="width:130px">Order</th>' +
      '</tr></thead><tbody>';
    D.PART_CATEGORIES.forEach(function (c) {
      var d = f.partsDays[c.id];
      var days = d.days;
      var klass = days < 2 ? 'bad' : (days < 5 ? 'warn' : 'good');
      var priceIdx = s.market.partPrices[c.id];
      html += '<tr><td>' + esc(c.name) + '</td>' +
        '<td class="r">' + money(s.inventory[c.id]) + '</td>' +
        '<td class="r">' + money(d.burn) + '</td>' +
        '<td class="r ' + klass + '">' + (days > 90 ? '90+' : days.toFixed(1)) + '</td>' +
        '<td class="r ' + (priceIdx > 1.03 ? 'bad' : (priceIdx < 0.97 ? 'good' : 'muted')) + '">' +
          priceIdx.toFixed(2) + '×</td>' +
        '<td class="r"><input type="number" min="0" step="50" data-order="' + c.id + '" value="' +
          (UI.order[c.id] || 0) + '"></td></tr>';
    });
    html += '</tbody></table></div>';

    if (s.incomingParts.length) {
      html += '<div class="panel" style="margin-top:14px"><header><h2>On the Truck</h2></header><table>' +
        '<thead><tr><th>Category</th><th class="r">Value</th><th class="r">Arrives</th></tr></thead><tbody>';
      s.incomingParts.forEach(function (p) {
        html += '<tr><td>' + esc((D.PART_CATEGORIES.filter(function (c) { return c.id === p.cat; })[0] || {}).name || p.cat) +
          '</td><td class="r">' + money(p.amount) + '</td><td class="r">day ' + p.day + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    return html;
  }

  /* --------------------------------------------------------------- marketing */

  function viewMarketing(s) {
    var f = NS.Sim.forecast(s);
    var total = S.dailyAdSpend(s);
    var leadsByChannel = {};
    f.demand.leads.forEach(function (l) { leadsByChannel[l.channel.id] = l.expected; });

    var html = '<div class="grid g2">';
    html += '<div class="panel"><header><h2>Daily Ad Budget</h2><span class="sub">' +
      money(total) + '/day &middot; ' + money(total * 30) + '/month</span></header>' +
      '<p class="small muted">Every channel saturates. Doubling spend past the saturation point ' +
      'buys very little. Leads you cannot answer or schedule are wasted money, so grow the ' +
      'counter and the bays alongside the budget.</p>';
    var costPerLead = null;
    var paidLeads = 0;
    D.CHANNELS.forEach(function (c) { paidLeads += leadsByChannel[c.id] || 0; });
    if (paidLeads > 0.01) costPerLead = total / paidLeads;
    html += '<div class="kv"><span class="k">Expected opportunities today</span><span class="v">' +
      f.expectedCars.toFixed(1) + '</span></div>' +
      '<div class="kv"><span class="k">From paid channels</span><span class="v">' +
        paidLeads.toFixed(1) + '</span></div>' +
      '<div class="kv"><span class="k">Blended cost per lead</span><span class="v">' +
        (costPerLead ? money(costPerLead) : '—') + '</span></div>' +
      '<div class="kv"><span class="k">Counter can work</span><span class="v">' +
        Math.round(f.counterCapacity) + ' ROs</span></div>' +
      '<div class="kv"><span class="k">Shop can sell</span><span class="v">' +
        hrs(f.capacityBookHours) + '</span></div>';
    if (f.expectedCars > f.counterCapacity * 1.2) {
      html += '<div class="alert warn" style="margin-top:9px">You are buying more demand than the ' +
        'counter can answer. Hire an advisor before raising the budget again.</div>';
    }
    html += '</div>';

    html += '<div class="panel"><header><h2>Reputation &amp; Word of Mouth</h2></header>' +
      '<div class="kv"><span class="k">Reputation</span><span class="v"><span class="stars">' +
        stars(s.reputation) + '</span> ' + s.reputation.toFixed(2) + '</span></div>' +
      '<div class="kv"><span class="k">Retained customers</span><span class="v">' +
        Math.round(s.customers.retained) + '</span></div>' +
      '<div class="kv"><span class="k">Repeat visits/day</span><span class="v">' +
        (leadsByChannel.repeat || 0).toFixed(1) + '</span></div>' +
      '<div class="kv"><span class="k">Walk-ins/day</span><span class="v">' +
        (leadsByChannel.walkin || 0).toFixed(1) + '</span></div>' +
      '<div class="kv"><span class="k">Competitive pressure</span><span class="v">' +
        pct(s.market.competitorPressure) + '</span></div>' +
      '<div class="kv"><span class="k">SEO authority built</span><span class="v">' +
        Math.round(s.adStock.seo) + '</span></div>' +
      '<div class="kv"><span class="k">Brand awareness (radio)</span><span class="v">' +
        Math.round(s.adStock.radio) + '</span></div>';
    html += '</div></div>';

    html += '<div class="panel" style="margin-top:14px"><header><h2>Channels</h2></header><div class="grid g2">';
    D.CHANNELS.forEach(function (c) {
      var spend = s.marketing[c.id] || 0;
      var leads = leadsByChannel[c.id] || 0;
      var cpl = leads > 0.01 ? spend / leads : null;
      html += '<div class="card"><header><div><h3>' + esc(c.name) + '</h3>' +
        '<div class="tiny muted">' + esc(c.desc) + '</div></div>' +
        '<span class="pill ' + (spend > 0 ? 'on' : '') + '">' + money(spend) + '/day</span></header>' +
        '<input type="range" min="0" max="' + Math.round(c.saturation * 1.6) + '" step="5" ' +
        'data-spend="' + c.id + '" value="' + spend + '">' +
        '<div class="row between tiny muted"><span>$0</span><span>saturates near ' +
        money(c.saturation) + '</span><span>' + money(Math.round(c.saturation * 1.6)) + '</span></div>' +
        '<div class="row between small" style="margin-top:6px">' +
        '<span>' + (c.mode === 'fleet' ? fleetOdds(s, spend) + ' chance of a contract/day'
          : (leads > 0.005 ? leads.toFixed(1) + ' leads/day' : 'no leads')) + '</span>' +
        '<span class="muted">' + (cpl ? money(cpl) + '/lead' : '') + '</span></div>' +
        '<div class="row wrap tiny muted" style="margin-top:5px;gap:8px">' +
        '<span>intent ' + c.intent.toFixed(2) + '×</span>' +
        '<span>price sensitivity ' + c.price.toFixed(2) + '×</span>' +
        '<span>ticket ' + c.ticket.toFixed(2) + '×</span></div>' +
        '</div>';
    });
    html += '</div></div>';

    if (s.fleetAccounts.length) {
      html += '<div class="panel" style="margin-top:14px"><header><h2>Fleet Accounts</h2>' +
        '<span class="sub">contracted work, invoiced net 15</span></header><table><thead><tr>' +
        '<th>Account</th><th class="r">Vehicles</th><th class="r">Jobs/day</th>' +
        '<th class="r">Labor discount</th><th class="r">Signed</th></tr></thead><tbody>';
      s.fleetAccounts.forEach(function (fa) {
        html += '<tr><td>' + esc(fa.name) + '</td><td class="r">' + fa.vehicles + '</td>' +
          '<td class="r">' + fa.jobsPerDay.toFixed(2) + '</td><td class="r">' + pct(fa.discount) +
          '</td><td class="r">day ' + fa.signedDay + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    return html;
  }

  /** Mirrors the fleet-signing roll in the simulation. */
  function fleetOdds(s, spend) {
    if (spend <= 0) return '0%';
    var trained = s.writers.reduce(function (a, w) {
      return a + (w.courses.indexOf('fleet') >= 0 ? 0.9 : 0);
    }, 0);
    return pct(Math.min(0.10, spend / 2100) * (s.reputation / 5) * (1 + trained), 1);
  }

  /* ----------------------------------------------------------------- pricing */

  function viewPricing(s) {
    var p = s.pricing;
    var effRate = p.laborRate * (1 - p.couponPct);
    var vsMarket = effRate / s.market.laborRate - 1;

    var html = '<div class="grid g2">';
    html += '<div class="panel"><header><h2>Menu Pricing</h2>' +
      '<span class="sub">market labor rate is ' + money(s.market.laborRate) + '/hr</span></header>';

    html += slider('Labor rate', 'laborRate', p.laborRate, D.CONFIG.laborRateMin,
      D.CONFIG.laborRateMax, 1, '$' + p.laborRate + '/hr',
      (vsMarket >= 0 ? '+' : '') + pct(vsMarket, 0) + ' vs the shop across town');

    html += slider('Parts markup', 'partsMarkup', Math.round(p.partsMarkup * 100), 5, 120, 1,
      Math.round(p.partsMarkup * 100) + '%',
      'gross margin on parts ' + pct(p.partsMarkup / (1 + p.partsMarkup)) +
      ' &middot; market is ' + pct(D.CONFIG.marketPartsMarkup));

    html += slider('Diagnostic fee', 'diagFee', p.diagFee, 0, 260, 5, '$' + p.diagFee,
      'charged per book hour of diagnosis. Free diagnosis pulls price shoppers.');

    html += slider('Standing discount', 'couponPct', Math.round(p.couponPct * 100), 0, 35, 1,
      Math.round(p.couponPct * 100) + '%',
      'a coupon buys volume and gives away margin');
    html += '</div>';

    html += '<div class="panel"><header><h2>What That Prices Out To</h2></header>' +
      '<table><thead><tr><th>Service</th><th class="r">Hours</th><th class="r">Your price</th>' +
      '<th class="r">Market</th><th class="r">GP</th></tr></thead><tbody>';
    ['oil_change', 'brake_front', 'check_engine', 'battery', 'timing_belt', 'ac_service',
      'alignment', 'tires_set'].forEach(function (id) {
      var job = D.JOBS_BY_ID[id];
      var line = NS.Sim.quoteLine(s, job, 0);
      var fair = NS.Sim.fairPrice(s, job);
      var gp = line.total - line.partsCost;
      var diff = line.total / fair - 1;
      html += '<tr><td>' + esc(job.name) + '</td><td class="r">' + job.bookHours.toFixed(1) + '</td>' +
        '<td class="r">' + money(line.total) + '</td>' +
        '<td class="r muted">' + money(fair) + '</td>' +
        '<td class="r ' + (diff > 0.18 ? 'bad' : (diff < -0.12 ? 'warn' : 'good')) + '">' +
        money(gp) + '</td></tr>';
    });
    html += '</tbody></table>' +
      '<p class="tiny muted" style="margin-top:8px">Green gross profit means the price is in a ' +
      'band customers accept. Red means you are well above market and the closing ratio will show it.</p>' +
      '</div></div>';

    html += '<div class="panel" style="margin-top:14px"><header><h2>Operating Policy</h2></header>' +
      '<div class="grid g3">';

    html += '<div class="field"><span class="lbl">Shift length</span>' +
      '<select data-policy="shiftHours">' + [7, 8, 9, 10].map(function (h) {
        return '<option value="' + h + '"' + (s.policy.shiftHours === h ? ' selected' : '') + '>' +
          h + ' hours</option>';
      }).join('') + '</select>' +
      '<span class="tiny dim">Longer shifts sell more hours and burn techs out faster.</span></div>';

    html += '<div class="field"><span class="lbl">Scheduling</span>' +
      '<select data-policy="scheduling">' +
      opt('balanced', 'Balanced', s.policy.scheduling) +
      opt('quick', 'Quick jobs first', s.policy.scheduling) +
      opt('profit', 'Highest profit per hour', s.policy.scheduling) +
      opt('fifo', 'First in, first out', s.policy.scheduling) +
      '</select><span class="tiny dim">Which car goes on the lift next.</span></div>';

    html += '<div class="field"><span class="lbl">How tight you book</span>' +
      '<select data-policy="overbook">' +
      opt('0.8', 'Conservative (80%)', String(s.policy.overbook)) +
      opt('1', 'Realistic (100%)', String(s.policy.overbook)) +
      opt('1.15', 'Aggressive (115%)', String(s.policy.overbook)) +
      opt('1.3', 'Packed (130%)', String(s.policy.overbook)) +
      '</select><span class="tiny dim">Overbooking sells more and finishes late.</span></div>';

    html += '<div class="field"><span class="lbl">Saturdays</span>' +
      '<label class="check"><input type="checkbox" data-policy="openSaturday"' +
      (s.policy.openSaturday ? ' checked' : '') + '> Open Saturday</label>' +
      '<span class="tiny dim">Saturday demand is about 72% of a weekday and full payroll.</span></div>';

    html += '<div class="field"><span class="lbl">Overtime</span>' +
      '<label class="check"><input type="checkbox" data-policy="allowOvertime"' +
      (s.policy.allowOvertime ? ' checked' : '') + '> Allow overtime</label>' +
      '<span class="tiny dim">Time and a half, more comebacks, unhappier techs.</span></div>';

    html += '<div class="field"><span class="lbl">Emergency parts</span>' +
      '<label class="check"><input type="checkbox" data-policy="emergencyParts"' +
      (s.policy.emergencyParts ? ' checked' : '') + '> Buy same-day at a premium</label>' +
      '<span class="tiny dim">Keeps cars moving when the shelf is empty. Costs ' +
      pct(D.CONFIG.emergencyPartsPremium) + ' more.</span></div>';

    html += '</div></div>';
    return html;
  }

  function opt(val, label, current) {
    return '<option value="' + val + '"' + (String(current) === String(val) ? ' selected' : '') +
      '>' + label + '</option>';
  }

  function slider(label, key, value, min, max, step, display, note) {
    return '<div class="field" style="margin-bottom:12px">' +
      '<div class="row between"><span class="lbl">' + label + '</span>' +
      '<span class="num" style="font-weight:650">' + display + '</span></div>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step +
      '" data-price="' + key + '" value="' + value + '">' +
      '<span class="tiny dim">' + note + '</span></div>';
  }

  /* ------------------------------------------------------------------- money */

  function viewMoney(s) {
    var r = s.lastReport;
    var h30 = s.history.slice(-30);
    var sum = function (key, sub) {
      return h30.reduce(function (a, d) { return a + (sub ? d[key][sub] : d[key]); }, 0);
    };
    var nw = NS.Sim.netWorth(s);

    var html = '<div class="grid g2">';

    html += '<div class="panel"><header><h2>Yesterday\'s P&amp;L</h2><span class="sub">' +
      (r ? r.dateLabel : 'no days closed yet') + '</span></header>';
    html += r ? plBlock(r) : '<p class="muted">Run a day to see the numbers.</p>';
    html += '</div>';

    html += '<div class="panel"><header><h2>Balance Sheet</h2></header>' +
      '<div class="pl">' +
      plLine('Cash', s.cash) +
      plLine('Parts inventory', S.inventoryValue(s)) +
      plLine('Fleet receivables', S.receivablesTotal(s)) +
      plLine('Equipment &amp; leaseholds', S.equipmentValue(s)) +
      plLine('Bank loan', -s.loan.principal) +
      plLine('Line of credit', -s.credit.balance) +
      plLine('Accrued tax', -s.taxes.accrued) +
      '<div class="line total"><span>Net worth</span><span>' + money(nw) + '</span></div>' +
      '</div>';
    html += '<div class="grid g2" style="margin-top:12px">' +
      '<div class="field"><span class="lbl">Borrow from the bank (' + pct(s.loan.apr, 1) + ' APR)</span>' +
      '<div class="row"><input type="number" id="borrowAmt" value="10000" step="1000">' +
      '<button class="sm" data-act="borrow">Borrow</button></div></div>' +
      '<div class="field"><span class="lbl">Pay down the note</span>' +
      '<div class="row"><input type="number" id="repayAmt" value="5000" step="1000">' +
      '<button class="sm" data-act="repay">Pay</button></div></div>';
    if (s.credit.balance > 0) {
      html += '<div class="field"><span class="lbl">Pay down the credit line (' +
        pct(s.credit.apr, 1) + ' APR)</span><div class="row">' +
        '<input type="number" id="repayCreditAmt" value="' + Math.round(s.credit.balance) + '" step="500">' +
        '<button class="sm" data-act="repaycredit">Pay</button></div></div>';
    }
    html += '</div></div>';
    html += '</div>';

    html += '<div class="panel" style="margin-top:14px"><header><h2>Last 30 Days</h2></header>' +
      '<div class="grid g4">' +
      tile('Revenue', money(sum('revenue')), '') +
      tile('Gross profit', money(sum('gross')), pct(s.stats.gpPct30) + ' margin') +
      tile('Net profit', '<span class="' + cls(sum('profit')) + '">' + money(sum('profit')) + '</span>',
        money(sum('profit') / Math.max(1, h30.length)) + '/day') +
      tile('Cars', Math.round(sum('cars')), money(s.stats.aro30) + ' average ticket') +
      '</div></div>';

    html += '<div class="panel" style="margin-top:14px"><header><h2>Daily Cost Structure</h2>' +
      '<span class="sub">what the doors cost to open</span></header><div class="pl">' +
      plLine('Technician wages (' + s.techs.length + ' at ' + s.policy.shiftHours + 'h)',
        -s.techs.reduce(function (a, t) { return a + t.wage * s.policy.shiftHours; }, 0)) +
      plLine('Advisor salaries', -s.writers.reduce(function (a, w) { return a + w.salary; }, 0)) +
      plLine('Payroll tax', -(S.dailyLaborCost(s) - s.techs.reduce(function (a, t) {
        return a + t.wage * s.policy.shiftHours; }, 0) - s.writers.reduce(function (a, w) {
          return a + w.salary; }, 0))) +
      plLine('Rent', -s.overhead.rent) +
      plLine('Utilities', -s.overhead.utilities) +
      plLine('Insurance', -s.overhead.insurance) +
      plLine('Software &amp; fees', -s.overhead.software) +
      plLine('Shop supplies', -s.overhead.supplies) +
      plLine('Upgrade upkeep', -S.upgradeUpkeep(s)) +
      plLine('Advertising', -S.dailyAdSpend(s)) +
      '<div class="line total"><span>Break-even revenue per day</span><span>' +
      money(S.dailyBreakEven(s)) + '</span></div></div>' +
      '<p class="tiny muted" style="margin-top:8px">Before parts. At ' + pct(s.stats.gpPct30 || 0.55) +
      ' gross margin you need about ' +
      money(S.dailyBreakEven(s) / Math.max(0.2, s.stats.gpPct30 || 0.55)) +
      ' in sales a day to break even.</p></div>';
    return html;
  }

  function plLine(label, amount, sub) {
    return '<div class="line' + (sub ? ' sub' : '') + '"><span>' + label + '</span>' +
      '<span class="' + (amount < 0 ? '' : '') + '">' + money(amount) + '</span></div>';
  }

  function plBlock(r) {
    var e = r.expenses;
    return '<div class="pl">' +
      plLine('Labor sales', r.revenue.labor) +
      plLine('Parts sales', r.revenue.parts) +
      '<div class="line total"><span>Total sales</span><span>' + money(r.revenue.total) + '</span></div>' +
      plLine('Parts cost', -r.cogs.parts, true) +
      '<div class="line total"><span>Gross profit</span><span>' + money(r.profit.gross) +
        ' <span class="muted small">(' + pct(r.profit.grossPct) + ')</span></span></div>' +
      plLine('Technician wages', -e.techPay, true) +
      plLine('Advisor salaries', -e.writerPay, true) +
      plLine('Payroll tax', -e.payrollTax, true) +
      plLine('Overhead', -e.overhead, true) +
      plLine('Upgrade upkeep', -e.upkeep, true) +
      plLine('Advertising', -e.marketing, true) +
      plLine('Interest', -e.interest, true) +
      plLine('Inventory shrink', -e.shrink, true) +
      (e.bills ? plLine('One-off bills', -e.bills, true) : '') +
      (e.tax ? plLine('Income tax', -e.tax, true) : '') +
      '<div class="line total"><span>Net profit</span><span class="' + cls(r.profit.net) + '">' +
      money(r.profit.net) + '</span></div></div>';
  }

  /* ----------------------------------------------------------------- reports */

  function viewReports(s) {
    var html = '<div class="grid g2">';

    html += '<div class="panel"><header><h2>Milestones</h2><span class="sub">' +
      Object.keys(s.milestones).length + ' of ' + D.MILESTONES.length + '</span></header><table><tbody>';
    D.MILESTONES.forEach(function (m) {
      var day = s.milestones[m.id];
      html += '<tr><td>' + (day ? '<span class="good">✓</span> ' : '<span class="dim">○</span> ') +
        esc(m.label) + '</td><td class="r small ' + (day ? 'good' : 'dim') + '">' +
        (day ? 'day ' + day : 'open') + '</td></tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="panel"><header><h2>Lifetime</h2></header><div class="pl">' +
      plLine('Total sales', s.totals.revenue) +
      plLine('Total net profit', s.totals.profit) +
      plLine('Cars completed', s.totals.cars) +
      plLine('Repair orders sold', s.totals.ros) +
      plLine('Tax paid', s.taxes.paidToDate) +
      '<div class="line total"><span>Days in business</span><span>' + (s.day - 1) + '</span></div>' +
      '</div>' +
      '<div class="row wrap" style="margin-top:12px">' +
      '<button class="sm" data-act="save">Save game</button>' +
      '<button class="sm" data-act="loadgame">Load save</button>' +
      '<button class="sm danger" data-act="newgame">New game</button>' +
      '<button class="sm ghost" data-act="help">How to play</button>' +
      '</div><div class="tiny dim" style="margin-top:8px">Seed: ' + esc(s.seed) +
      ' &middot; ' + esc(D.DIFFICULTY[s.difficulty].label) + '</div></div>';
    html += '</div>';

    html += '<div class="panel" style="margin-top:14px"><header><h2>Daily History</h2>' +
      '<span class="sub">most recent first</span></header>' +
      '<div style="max-height:420px;overflow:auto"><table><thead><tr>' +
      '<th>Day</th><th class="r">Cars</th><th class="r">Sales</th><th class="r">Gross</th>' +
      '<th class="r">Net</th><th class="r">Billed hrs</th><th class="r">Eff</th>' +
      '<th class="r">Close</th><th class="r">Cash</th><th class="r">Rep</th></tr></thead><tbody>';
    s.history.slice().reverse().slice(0, 120).forEach(function (d) {
      html += '<tr><td>' + d.day + '</td><td class="r">' + d.cars + '</td>' +
        '<td class="r">' + money(d.revenue) + '</td>' +
        '<td class="r">' + money(d.gross) + '</td>' +
        '<td class="r ' + cls(d.profit) + '">' + money(d.profit) + '</td>' +
        '<td class="r">' + d.billed.toFixed(1) + '</td>' +
        '<td class="r">' + (d.worked > 0 ? pct(d.billed / d.worked) : '—') + '</td>' +
        '<td class="r">' + (d.quoted > 0 ? pct(d.approved / d.quoted) : '—') + '</td>' +
        '<td class="r">' + money(d.cash) + '</td>' +
        '<td class="r">' + d.rep.toFixed(2) + '</td></tr>';
    });
    html += '</tbody></table></div></div>';

    html += '<div class="panel" style="margin-top:14px"><header><h2>Full Log</h2></header>' +
      logList(s, 120) + '</div>';
    return html;
  }

  /* ------------------------------------------------------------- day report */

  function showDayReport(r) {
    var s = UI.state;
    var c = r.counter;
    var sh = r.shop;
    var body = '';

    if (!r.open) {
      body += '<div class="alert warn">' + r.closedReason + '. Fixed costs still ran.</div>';
    }

    body += '<div class="grid g4">' +
      tile('Sales', money(r.revenue.total), sh.completed + ' cars delivered') +
      tile('Gross profit', money(r.profit.gross), pct(r.profit.grossPct) + ' margin') +
      tile('Net profit', '<span class="' + cls(r.profit.net) + '">' + sign(r.profit.net) + '</span>',
        'cash now ' + money(s.cash)) +
      tile('Satisfaction', r.csi ? r.csi.toFixed(2) + ' / 5' : '—',
        'reputation ' + r.repBefore.toFixed(2) + ' → ' + r.repAfter.toFixed(2)) +
      '</div>';

    if (r.events.length) {
      body += '<div class="col" style="margin-top:12px">';
      r.events.forEach(function (e) {
        body += '<div class="alert">' + esc(e) + '</div>';
      });
      body += '</div>';
    }
    if (r.notes.length) {
      body += '<div class="col" style="margin-top:8px">';
      r.notes.forEach(function (n) {
        body += '<div class="alert ' + (n.indexOf('Morale warning') === 0 ? 'warn' : '') + '">' +
          esc(n) + '</div>';
      });
      body += '</div>';
    }

    body += '<div class="grid g2" style="margin-top:12px">';

    body += '<div class="panel"><header><h3>The Counter</h3></header><div class="pl">' +
      plRow('Opportunities', c.opportunities) +
      plRow('Worked by an advisor', c.handled) +
      plRow('Calls nobody answered', c.missedCalls, c.missedCalls > 0) +
      plRow('Turned away, no equipment', c.noTooling, c.noTooling > 0) +
      plRow('Turned away, no HV training', c.noEvTraining, c.noEvTraining > 0) +
      plRow('Lost, booked too far out', c.lostToBacklog, c.lostToBacklog > 0) +
      plRow('Estimates written', c.quoted) +
      plRow('Approved', c.approved) +
      plRow('Declined', c.declined) +
      plRow('Upsells added', c.upsells) +
      '<div class="line total"><span>Closing ratio</span><span>' +
        (c.quoted ? pct(c.approved / c.quoted) : '—') + '</span></div>' +
      '<div class="line total"><span>Average approved ticket</span><span>' +
        (c.approved ? money(c.approvedValue / c.approved) : '—') + '</span></div>' +
      (c.lostValue > 0 ? '<div class="line sub"><span>Value walked out the door</span><span class="bad">' +
        money(c.lostValue) + '</span></div>' : '') +
      '</div></div>';

    body += '<div class="panel"><header><h3>The Floor</h3></header><div class="pl">' +
      plRow('Bay hours available', sh.bayHours.toFixed(1)) +
      plRow('Bay hours used', sh.bayHoursUsed.toFixed(1)) +
      plRow('Tech hours worked', sh.techHoursUsed.toFixed(1)) +
      plRow('Hours billed', sh.billedHours.toFixed(1)) +
      plRow('Overtime', sh.overtimeHours.toFixed(1), sh.overtimeHours > 0) +
      plRow('Cars carried overnight', sh.carryover, sh.carryover > 0) +
      plRow('Waiting on parts', sh.partsWaits, sh.partsWaits > 0) +
      plRow('Emergency parts runs', sh.emergencyOrders, sh.emergencyOrders > 0) +
      plRow('Comebacks created', sh.comebacks, sh.comebacks > 0) +
      '<div class="line total"><span>Efficiency (billed / worked)</span><span>' +
        pct(sh.efficiency) + '</span></div>' +
      '<div class="line total"><span>Bay utilization</span><span>' + pct(sh.utilization) + '</span></div>' +
      '</div></div>';
    body += '</div>';

    body += '<div class="panel" style="margin-top:12px"><header><h3>Profit &amp; Loss</h3></header>' +
      plBlock(r) + '</div>';

    if (r.completedList.length) {
      body += '<div class="panel" style="margin-top:12px"><header><h3>Cars Delivered</h3></header>' +
        '<div style="max-height:260px;overflow:auto"><table><thead><tr><th>Work</th><th>Tech</th>' +
        '<th>Bay</th><th class="r">Hours</th><th class="r">Ticket</th><th class="r">CSI</th>' +
        '</tr></thead><tbody>';
      r.completedList.forEach(function (x) {
        body += '<tr><td>' + esc(x.names.join(' + ')) +
          (x.comeback ? ' <span class="pill bad">comeback</span>' : '') +
          (x.fleet ? ' <span class="pill">fleet</span>' : '') + '</td>' +
          '<td class="small">' + esc(x.tech) + '</td><td class="small">' + esc(x.bay) + '</td>' +
          '<td class="r">' + x.hours.toFixed(1) + '</td>' +
          '<td class="r">' + money(x.revenue) + '</td>' +
          '<td class="r ' + (x.csi >= 4.3 ? 'good' : (x.csi < 3 ? 'bad' : 'warn')) + '">' +
          x.csi.toFixed(1) + '</td></tr>';
      });
      body += '</tbody></table></div></div>';
    }

    var missed = Object.keys(c.missedWork);
    if (missed.length) {
      body += '<div class="panel" style="margin-top:12px"><header><h3>Work You Turned Away</h3></header>' +
        '<table><thead><tr><th>Service</th><th>Why</th><th class="r">Cars</th>' +
        '<th class="r">Value</th></tr></thead><tbody>';
      missed.sort(function (a, b) { return c.missedWork[b].value - c.missedWork[a].value; })
        .forEach(function (id) {
          var m = c.missedWork[id];
          body += '<tr><td>' + esc(m.name) + '</td><td class="small muted">' + esc(m.reason) +
            '</td><td class="r">' + m.count + '</td><td class="r bad">' + money(m.value) + '</td></tr>';
        });
      body += '</tbody></table></div>';
    }

    openModal('Day ' + r.day + ' — ' + r.dateLabel + '  ' + r.weather.icon + ' ' + r.weather.name,
      body, '<button class="primary" data-act="closemodal">Continue</button>');
  }

  function plRow(label, value, flag) {
    return '<div class="line"><span>' + label + '</span><span class="' + (flag ? 'warn' : '') + '">' +
      value + '</span></div>';
  }

  /* ------------------------------------------------------------------ modals */

  function openModal(title, body, foot) {
    UI.modal = true;
    document.getElementById('modalHost').innerHTML =
      '<div class="scrim" data-scrim="1"><div class="modal">' +
      '<header><h2>' + title + '</h2><button class="sm ghost" data-act="closemodal">✕</button></header>' +
      '<div class="body">' + body + '</div>' +
      '<div class="foot">' + (foot || '<button data-act="closemodal">Close</button>') + '</div>' +
      '</div></div>';
  }

  function closeModal() {
    UI.modal = null;
    document.getElementById('modalHost').innerHTML = '';
    if (UI.state.gameOver) showGameOver();
  }

  function showGameOver() {
    var s = UI.state;
    openModal('The Doors Are Closed',
      '<div class="gameover"><h2>Out of business on day ' + s.gameOver.day + '</h2>' +
      '<p class="muted">' + esc(s.gameOver.reason) + '</p>' +
      '<div class="grid g4" style="margin-top:16px">' +
      tile('Lifetime sales', money(s.totals.revenue), '') +
      tile('Cars delivered', s.totals.cars, '') +
      tile('Final reputation', s.reputation.toFixed(2), '') +
      tile('Net worth', money(NS.Sim.netWorth(s)), '') +
      '</div></div>',
      '<button class="primary" data-act="newgame">Start over</button>');
  }

  function showNewGame() {
    var body = '<p class="muted">You are taking over a three-bay independent repair shop. ' +
      'Every day you decide what to charge, what to stock, who to hire, what to buy and how ' +
      'much demand to go out and buy. Then you open the doors and find out.</p>' +
      '<div class="grid g3" style="margin-top:12px">';
    Object.keys(D.DIFFICULTY).forEach(function (id) {
      var d = D.DIFFICULTY[id];
      body += '<div class="card"><h3>' + esc(d.label) + '</h3>' +
        '<p class="tiny muted">' + esc(d.note) + '</p>' +
        '<div class="kv"><span class="k">Starting cash</span><span class="v">' + money(d.cash) + '</span></div>' +
        '<div class="kv"><span class="k">Debt</span><span class="v">' + money(d.loan) + '</span></div>' +
        '<div class="kv"><span class="k">Reputation</span><span class="v">' + d.repStart.toFixed(1) + ' ★</span></div>' +
        '<button class="sm primary" style="width:100%;margin-top:8px" data-act="start:' + id +
        '">Start</button></div>';
    });
    body += '</div><div class="grid g2" style="margin-top:12px">' +
      '<div class="field"><span class="lbl">Shop name</span>' +
      '<input type="text" id="newName" value="Redline Auto Service"></div>' +
      '<div class="field"><span class="lbl">Seed (optional, for a repeatable town)</span>' +
      '<input type="text" id="newSeed" value=""></div></div>';
    openModal('Open for Business', body, '<button data-act="closemodal">Cancel</button>');
  }

  function showMenu() {
    var s = UI.state;
    openModal('Shop Office',
      '<div class="grid g2">' +
      '<div class="card"><h3>' + esc(s.shopName) + '</h3>' +
      '<div class="kv"><span class="k">Day</span><span class="v">' + s.day + '</span></div>' +
      '<div class="kv"><span class="k">Difficulty</span><span class="v">' +
        esc(D.DIFFICULTY[s.difficulty].label) + '</span></div>' +
      '<div class="kv"><span class="k">Seed</span><span class="v mono small">' +
        esc(s.seed) + '</span></div>' +
      '<div class="kv"><span class="k">Net worth</span><span class="v">' +
        money(NS.Sim.netWorth(s)) + '</span></div></div>' +
      '<div class="card"><h3>Game</h3><div class="col" style="margin-top:8px">' +
      '<button data-act="save">Save now</button>' +
      '<button data-act="loadgame">Load last save</button>' +
      '<button data-act="help">How to play</button>' +
      '<button class="danger" data-act="newgame">Start a new shop</button>' +
      '</div><p class="tiny dim" style="margin-top:8px">The game autosaves after every day. ' +
      'Press <b>Space</b> to open the shop.</p></div></div>',
      '<button data-act="closemodal">Close</button>');
  }

  function showHelp() {
    openModal('How to Play',
      '<div class="col">' +
      '<p><b>The loop.</b> Set your prices, order parts, staff the shop, buy demand, then press ' +
      '<b>Open the Shop</b>. One day runs and you get a full report.</p>' +
      '<p><b>Capacity is the whole game.</b> A bay can only do work its tools support. A tech turns ' +
      'book hours into clock hours at a rate set by skill, tools, morale and fatigue. An advisor ' +
      'can only work so many repair orders a day. Parking limits how many cars can physically be ' +
      'on the property. Buy demand past any of those limits and the money is wasted.</p>' +
      '<p><b>Book hours vs clock hours.</b> You bill the customer the labor guide time. You pay the ' +
      'tech real time. Efficiency above 100% means the crew beats book time. That gap is the profit.</p>' +
      '<p><b>Levers worth pulling.</b> Labor rate and parts markup move both margin and closing ' +
      'ratio. Tooling unlocks services you currently turn away, then makes them faster. Training ' +
      'raises tech speed and advisor closing/upsell. Advertising channels each saturate — spread ' +
      'the budget and watch cost per lead. Reputation compounds through repeat customers.</p>' +
      '<p><b>Ways to die.</b> Running out of cash for three straight days. Chronic late delivery ' +
      'tanks reputation, which tanks traffic. Underpaying techs who have leveled up makes them quit.</p>' +
      '<p class="dim tiny">Everything is deterministic from the seed, so the same decisions on the ' +
      'same seed always play out the same way.</p></div>',
      '<button class="primary" data-act="closemodal">Got it</button>');
  }

  function toast(msg, bad) {
    var host = document.getElementById('toastHost');
    host.innerHTML = '<div class="toast' + (bad ? ' bad' : '') + '">' + esc(msg) + '</div>';
    clearTimeout(UI.toastTimer);
    UI.toastTimer = setTimeout(function () { host.innerHTML = ''; }, 3200);
  }

  /* ----------------------------------------------------------------- events */

  function result(res) {
    if (res) toast(res.msg, !res.ok);
    UI.render();
  }

  function onClick(ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) {
      if (ev.target.dataset && ev.target.dataset.scrim) closeModal();
      return;
    }
    var act = el.dataset.act;
    var s = UI.state;
    var parts = act.split(':');

    switch (parts[0]) {
      case 'run': runDay(); return;
      case 'tab': UI.tab = parts[1]; UI.render(); return;
      case 'menu': showMenu(); return;
      case 'help': showHelp(); return;
      case 'closemodal': closeModal(); return;
      case 'newgame': showNewGame(); return;
      case 'start': startGame(parts[1]); return;
      case 'save': {
        var saved = S.save(s);
        toast(saved ? 'Saved.' : 'Could not save (storage blocked).', !saved);
        return;
      }
      case 'loadgame': {
        var loaded = S.load();
        if (!loaded) { toast('No save found.', true); return; }
        UI.state = loaded;
        closeModal();
        toast('Loaded day ' + loaded.day + '.');
        UI.render();
        return;
      }
      case 'tool': result(A.upgradeTool(s, parts[1], parts[2])); return;
      case 'bay':
        if (parts[1] === 'build') result(A.buildBay(s));
        else if (parts[1] === 'toggle') result(A.toggleBay(s, parts[2]));
        else if (parts[1] === 'repair') result(A.repairBay(s, parts[2]));
        return;
      case 'park': result(A.addParking(s, Number(parts[1]))); return;
      case 'up': result(A.buyUpgrade(s, parts[1])); return;
      case 'hire': result(A.hire(s, parts[1], parts[2])); return;
      case 'fire': result(A.fire(s, parts[1], parts[2])); return;
      case 'raise':
        result(A.raise(s, parts[1], parts[2], parts[1] === 'tech' ? 2 : 15));
        return;
      case 'train': {
        var sel = document.querySelector('[data-course="' + parts[1] + ':' + parts[2] + '"]');
        if (!sel || !sel.value) { toast('Pick a course first.', true); return; }
        result(A.startTraining(s, parts[1], parts[2], sel.value));
        return;
      }
      case 'recruit': result(A.recruit(s)); return;
      case 'order': {
        var res = A.orderParts(s, UI.order);
        if (res.ok) UI.order = {};
        result(res);
        return;
      }
      case 'clearorder': UI.order = {}; UI.render(); return;
      case 'stock': {
        var r2 = A.autoStock(s, Number(parts[1]));
        if (r2.ok) UI.order = {};
        result(r2);
        return;
      }
      case 'borrow':
        result(A.borrow(s, Number(document.getElementById('borrowAmt').value)));
        return;
      case 'repay':
        result(A.repayLoan(s, Number(document.getElementById('repayAmt').value)));
        return;
      case 'repaycredit':
        result(A.repayCredit(s, Number(document.getElementById('repayCreditAmt').value)));
        return;
      case 'offer':
        result(A.resolveOffer(s, parts[1], parts[2] === 'yes'));
        return;
      default: return;
    }
  }

  function onChange(ev) {
    var t = ev.target;
    var s = UI.state;
    if (t.dataset.policy) {
      var key = t.dataset.policy;
      var val = t.type === 'checkbox' ? t.checked : t.value;
      if (key === 'shiftHours' || key === 'overbook') val = Number(val);
      A.setPolicy(s, key, val);
      UI.render();
      return;
    }
    if (t.dataset.order !== undefined) {
      UI.order[t.dataset.order] = Math.max(0, Number(t.value) || 0);
      UI.render();
      return;
    }
  }

  function onInput(ev) {
    var t = ev.target;
    var s = UI.state;
    if (t.dataset.price) {
      var v = Number(t.value);
      if (t.dataset.price === 'laborRate') A.setLaborRate(s, v);
      if (t.dataset.price === 'partsMarkup') A.setPartsMarkup(s, v / 100);
      if (t.dataset.price === 'diagFee') A.setDiagFee(s, v);
      if (t.dataset.price === 'couponPct') A.setCoupon(s, v / 100);
      UI.render();
      var again = document.querySelector('[data-price="' + t.dataset.price + '"]');
      if (again) again.focus();
      return;
    }
    if (t.dataset.spend) {
      A.setChannelSpend(s, t.dataset.spend, Number(t.value));
      UI.render();
      var back = document.querySelector('[data-spend="' + t.dataset.spend + '"]');
      if (back) back.focus();
      return;
    }
  }

  function onKey(ev) {
    if (ev.key === 'Escape' && UI.modal) closeModal();
    if (ev.key === ' ' && !UI.modal && ev.target === document.body) {
      ev.preventDefault();
      runDay();
    }
  }

  function runDay() {
    var s = UI.state;
    if (s.gameOver) { showGameOver(); return; }
    var report = NS.Sim.runDay(s);
    S.save(s);
    UI.render();
    showDayReport(report);
  }

  function startGame(difficulty) {
    var nameEl = document.getElementById('newName');
    var seedEl = document.getElementById('newSeed');
    UI.state = S.newGame({
      difficulty: difficulty,
      shopName: (nameEl && nameEl.value.trim()) || 'Redline Auto Service',
      seed: seedEl ? seedEl.value.trim() : ''
    });
    UI.order = {};
    UI.tab = 'dashboard';
    closeModal();
    S.save(UI.state);
    UI.render();
    showHelp();
  }

  UI.showNewGame = showNewGame;
  UI.showHelp = showHelp;
  UI.toast = toast;
})(AutoShop);
