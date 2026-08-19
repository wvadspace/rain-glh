/* ==========================================================================
   ui.js — rendering. Every view is a pure function of state that returns
   HTML; interaction happens through delegated [data-action] handlers.
   ========================================================================== */
(function (root) {
  'use strict';
  var AS = root.AS = root.AS || {};
  var C = AS.CONFIG;
  var UI = AS.UI = { tab: 'office' };

  var $ = function (sel) { return document.querySelector(sel); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function money(n) { return AS.money(n); }
  function cls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }
  function clockTime(h) {
    var t = 8 + h, ap = t >= 12 ? 'pm' : 'am', hh = t > 12 ? t - 12 : t;
    return hh + ':00' + ap;
  }

  /* ================= header ================= */
  UI.renderHeader = function (s) {
    $('#hdrShop').textContent = s.shopName;
    $('#hdrDate').textContent = AS.dateLabel(s) + ' — ' + AS.location(s).name;
    var last = s.history[s.history.length - 1];
    $('#hdrStats').innerHTML = [
      stat('Cash', money(s.cash), s.cash < 0 ? 'neg' : ''),
      stat('Debt', money(s.loan), s.loan > 0 ? 'warnc' : ''),
      stat('Reputation', s.reputation.toFixed(0) + ' / 100', s.reputation >= 75 ? 'pos' : s.reputation < 40 ? 'neg' : ''),
      stat('Loyal Customers', Math.round(s.customerBase).toLocaleString()),
      stat('Parts On Hand', money(s.partsStock)),
      stat('Yesterday', last ? money(last.net) : '—', last ? cls(last.net) : '')
    ].join('');
  };
  function stat(k, v, c) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v ' + (c || '') + '">' + v + '</div></div>';
  }

  /* ================= shared bits ================= */
  function kpi(k, v, d, c) {
    return '<div class="kpi"><div class="k">' + k + '</div><div class="v ' + (c || '') + '">' + v + '</div>' +
      (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  }
  function row(l, v, c) {
    return '<div class="row"><span class="lbl">' + l + '</span><span class="val ' + (c || '') + '">' + v + '</span></div>';
  }
  function mini(k, v) {
    return '<div class="mini"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }
  function bar(pct, kind) {
    return '<div class="bar ' + (kind || '') + '"><i style="width:' + Math.max(0, Math.min(100, pct * 100)).toFixed(1) + '%"></i></div>';
  }
  function ladder(lvl, max) {
    var out = '<div class="ladder">';
    for (var i = 1; i <= (max || 5); i++) out += '<i class="' + (i <= lvl ? 'on' : '') + '"></i>';
    return out + '</div>';
  }
  function afford(s, cost) { return s.cash - cost >= -AS.creditLimit(s) + 500; }
  function costBtn(action, id, cost, label, s) {
    var ok = afford(s, cost);
    return '<button class="btn btn-sm" data-action="' + action + '" data-id="' + id + '"' + (ok ? '' : ' disabled') + '>' +
      label + ' <span class="muted">' + money(cost) + '</span></button>';
  }

  /* ================= capacity snapshot ================= */
  UI.capacity = function (s) {
    var hours = AS.WEEK[s.dow].hours;
    var built = AS.buildStations(s, hours);
    var sellable = built.stations.reduce(function (n, st) { return n + st.capacity * st.eff; }, 0);
    var advCap = s.advisors.filter(function (a) { return a.training <= 0; })
      .reduce(function (n, a) { return n + Math.round(AS.advisorLevel(a).roCap * (hours / 9)); }, 0);
    var maxEquip = built.stations.reduce(function (m, st) { return Math.max(m, st.equip); }, 0);
    var maxSkill = built.stations.reduce(function (m, st) { return Math.max(m, st.skill); }, 0);
    return {
      hours: hours, stations: built.stations, sellable: sellable, advCap: advCap,
      idleBays: built.idleBays, idleTechs: built.idleTechs, maxEquip: maxEquip, maxSkill: maxSkill
    };
  };

  /* Expected demand before the weather roll. On a closed day we forecast the
     next open day instead, so the marketing numbers are never a row of zeroes. */
  UI.forecast = function (s) {
    var view = s;
    if (!AS.WEEK[s.dow].open) {
      var dow = s.dow;
      for (var i = 0; i < 7 && !AS.WEEK[dow].open; i++) dow = (dow + 1) % 7;
      view = Object.create(s); view.dow = dow;
    }
    var sources = AS.computeTraffic(view, { traffic: 1 });
    var total = sources.reduce(function (n, x) { return n + x.leads; }, 0);
    return { total: total, sources: sources };
  };

  UI.warnings = function (s) {
    var cap = UI.capacity(s), w = [];
    if (!cap.stations.length) w.push(['bad', 'You have no working station. A bay without a technician — or a tech without a bay — produces nothing.']);
    if (cap.idleBays > 0) w.push(['warn', cap.idleBays + ' bay' + (cap.idleBays > 1 ? 's are' : ' is') + ' sitting empty with no technician assigned. You are paying upkeep on tooling nobody is using.']);
    if (cap.idleTechs > 0) w.push(['bad', cap.idleTechs + ' technician' + (cap.idleTechs > 1 ? 's have' : ' has') + ' no bay to work in. That is full wages for zero billed hours.']);
    var f = UI.forecast(s);
    if (f.total > cap.advCap * 1.05) w.push(['warn', 'Roughly ' + Math.round(f.total) + ' customers are expected and your counter can only handle about ' + cap.advCap + '. Some will walk out unserved.']);
    if (f.total * 0.55 > s.spaces * 1.6) w.push(['warn', 'Your lot has ' + s.spaces + ' spaces. On a busy day you will run out of places to put cars.']);
    if (s.partsStock < 900) w.push(['warn', 'Parts inventory is low (' + money(s.partsStock) + '). Jobs needing parts you do not stock get pushed to tomorrow.']);
    if (s.cash < 3000) w.push(['bad', 'Cash is thin. Credit limit is ' + money(AS.creditLimit(s)) + '; past that the landlord takes the keys.']);
    if (s.reputation < 35) w.push(['bad', 'Reputation is in the gutter. Organic traffic is drying up.']);
    var tired = s.techs.filter(function (t) { return t.fatigue > 35; });
    if (tired.length) w.push(['warn', tired.map(function (t) { return t.name; }).join(', ') + ' ' + (tired.length > 1 ? 'are' : 'is') + ' burned out. Efficiency is dropping — a slow day will help.']);
    var lowMorale = s.techs.concat(s.advisors).filter(function (t) { return t.morale < 40; });
    if (lowMorale.length) w.push(['warn', lowMorale.map(function (t) { return t.name; }).join(', ') + ' — morale is low. Idle shops and 100% days both wear people down.']);
    return w;
  };

  /* ================= VIEW: FRONT OFFICE ================= */
  UI.views = {};
  UI.views.office = function (s) {
    var cap = UI.capacity(s), f = UI.forecast(s);
    var last = s.history[s.history.length - 1];
    var warn = UI.warnings(s);
    var week = AS.WEEK[s.dow];

    var h = '<div class="grid g2">';

    /* --- today --- */
    h += '<div class="card"><h3>Today &mdash; ' + AS.DAYS[s.dow] + '</h3>' +
      '<div class="sub">' + AS.MONTHS[s.month] + ', Year ' + s.year + '. ' +
      (week.open ? 'Open ' + clockTime(0) + ' to ' + clockTime(week.hours) + ' (' + week.hours + ' hours).' : 'Closed today.') + '</div>' +
      '<div class="grid g3">' +
      kpi('Expected Cars', Math.round(f.total), 'traffic before weather') +
      kpi('Sellable Hours', cap.sellable.toFixed(1), cap.stations.length + ' station' + (cap.stations.length === 1 ? '' : 's')) +
      kpi('Counter Capacity', cap.advCap, s.advisors.length + ' advisor' + (s.advisors.length === 1 ? '' : 's')) +
      '</div>' +
      '<div class="hr"></div>' +
      row('Labor rate', '$' + s.pricing.laborRate + '/hr <span class="muted small">(town avg $' + C.marketLaborRate + ')</span>') +
      row('Highest tooling on the floor', 'Level ' + cap.maxEquip + ' — ' + (cap.maxEquip ? AS.EQUIP[cap.maxEquip - 1].name : 'none')) +
      row('Highest ticket on the floor', 'Level ' + cap.maxSkill + ' — ' + (cap.maxSkill ? AS.TECH_LEVELS[cap.maxSkill - 1].title : 'none')) +
      row('Parking', s.spaces + ' spaces' + (s.wip.length ? ' — ' + s.wip.length + ' held overnight' : '')) +
      row('Booked for today', s.booked.length + ' appointment' + (s.booked.length === 1 ? '' : 's')) +
      row('Daily advertising', money(Object.keys(s.adSpend).reduce(function (n, k) { return n + s.adSpend[k]; }, 0))) +
      '</div>';

    /* --- where traffic comes from --- */
    h += '<div class="card"><h3>Where Today&rsquo;s Traffic Comes From</h3>' +
      '<div class="sub">Estimated customers by source. Advertising builds an awareness stock that decays if you stop paying.</div>';
    f.sources.slice().sort(function (a, b) { return b.leads - a.leads; }).forEach(function (src) {
      if (src.leads < 0.05) return;
      var ch = AS.CHANNEL_BY_ID[src.id];
      var name = src.id === 'organic' ? 'Drive-by &amp; word of mouth'
               : src.id === 'repeat' ? 'Returning customers' : ch.name;
      h += '<div style="margin-bottom:9px"><div class="spread small"><span>' + name + '</span>' +
        '<span class="mono">' + src.leads.toFixed(1) + '</span></div>' +
        bar(src.leads / Math.max(1, f.total), src.id === 'organic' || src.id === 'repeat' ? 'g' : 'b') + '</div>';
    });
    h += '<div class="hr"></div><div class="note info small">Reputation ' + s.reputation.toFixed(0) +
      ' and ' + Math.round(s.customerBase).toLocaleString() + ' loyal customers are doing ' +
      Math.round((f.sources[0].leads + f.sources[1].leads) / Math.max(0.01, f.total) * 100) + '% of your lead generation for free.</div>';
    h += '</div>';

    h += '</div>'; /* end g2 */

    /* --- warnings --- */
    if (warn.length) {
      h += '<div class="card" style="margin-top:16px"><h3>Before You Open</h3>';
      warn.forEach(function (w) { h += '<div class="note ' + w[0] + '">' + w[1] + '</div>'; });
      h += '</div>';
    }

    /* --- stations --- */
    h += '<div class="card" style="margin-top:16px"><h3>Stations On The Floor <span class="muted small">bay + technician</span></h3>' +
      '<div class="sub">Your best technician is paired with your best-equipped bay automatically. A station can only do work its <em>equipment</em> and its <em>technician</em> both allow.</div>';
    if (!cap.stations.length) {
      h += '<div class="note bad">Nothing is running. You need at least one bay and one available technician.</div>';
    } else {
      h += '<div class="scroll"><table><thead><tr><th>Bay</th><th>Technician</th><th class="n">Hours</th><th class="n">Efficiency</th><th>Can Perform</th></tr></thead><tbody>';
      cap.stations.forEach(function (st) {
        var jobs = AS.JOBS.filter(function (j) { return j.equip <= st.equip && j.skill <= st.skill; });
        var top = jobs.slice().sort(function (a, b) { return b.hours - a.hours; })[0];
        h += '<tr><td>Lvl ' + st.equip + ' &middot; ' + AS.EQUIP[st.equip - 1].name + '</td>' +
          '<td>' + esc(st.tech.name) + ' <span class="pill">' + AS.TECH_LEVELS[st.skill - 1].title + '</span></td>' +
          '<td class="n">' + st.capacity.toFixed(1) + '</td>' +
          '<td class="n">' + (st.eff * 100).toFixed(0) + '%</td>' +
          '<td class="small muted">' + jobs.length + ' of ' + AS.JOBS.length + ' job types' +
          (top ? ' &mdash; up to ' + esc(top.name) : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    /* --- yesterday --- */
    if (last) {
      h += '<div class="card" style="margin-top:16px"><h3>Yesterday' +
        '<button class="btn btn-sm" data-action="show-last-report">Full Report</button></h3>' +
        '<div class="grid g4">' +
        kpi('Revenue', money(last.revenue)) +
        kpi('Net', money(last.net), '', cls(last.net)) +
        kpi('Cars', last.cars) +
        kpi('ARO', money(last.aro)) +
        kpi('Bay Utilization', (last.util * 100).toFixed(0) + '%') +
        kpi('Billed Hours', last.billed.toFixed(1)) +
        '</div></div>';
    }
    return h;
  };

  /* ================= VIEW: SHOP FLOOR ================= */
  UI.views.floor = function (s) {
    var loc = AS.location(s);
    var hours = AS.WEEK[s.dow].hours || 9;
    var built = AS.buildStations(s, hours);
    var pairing = {};
    built.stations.forEach(function (st) { pairing[st.bay.id] = st.tech; });

    var h = '<div class="grid g2">';

    h += '<div class="card"><h3>Service Bays <span class="pill">' + s.bays.length + ' / ' + loc.maxBays + '</span></h3>' +
      '<div class="sub">Equipment decides what work can physically be done. Every level is a different set of tools bolted to the floor.</div>';

    s.bays.slice().sort(function (a, b) { return b.lvl - a.lvl; }).forEach(function (b) {
      var eq = AS.equip(b), next = AS.EQUIP[b.lvl];
      var tech = pairing[b.id];
      var jobs = AS.JOBS.filter(function (j) { return j.equip <= b.lvl; });
      var unlocks = next ? AS.JOBS.filter(function (j) { return j.equip === next.lvl; }) : [];
      h += '<div class="unit' + (b.down ? ' down' : '') + '">' +
        '<div class="unit-ico">' + (b.down ? '&#9888;' : '&#128295;') + '</div>' +
        '<div class="unit-body">' +
          '<div class="unit-title">' + esc(eq.name) + ' <span class="pill amber">Level ' + b.lvl + '</span>' +
            (b.down ? '<span class="pill red">Down ' + b.down + 'd</span>' : '') +
            (tech ? '<span class="pill green">' + esc(tech.name) + '</span>' : '<span class="pill red">No technician</span>') +
          '</div>' +
          '<div class="unit-meta">' + esc(eq.blurb) + '</div>' +
          ladder(b.lvl, 5) +
          '<div class="unit-meta">Handles ' + jobs.length + ' job types &middot; speed ' + (eq.eff * 100).toFixed(0) + '% &middot; upkeep ' + money(eq.upkeep) + '/day' +
            (b.lifetimeHours ? ' &middot; ' + b.lifetimeHours.toFixed(0) + ' hours billed lifetime' : '') + '</div>' +
          (next ? '<div class="unit-meta">Next: <strong>' + esc(next.name) + '</strong> unlocks ' +
            (unlocks.length ? nameList(unlocks) : 'faster work') + '</div>' : '') +
        '</div>' +
        '<div class="unit-actions">' +
          (next ? costBtn('upgrade-bay', b.id, next.cost, 'Upgrade', s)
                : '<span class="pill green">Fully Equipped</span>') +
        '</div></div>';
    });

    var bayCost = AS.bayBuildCost(s);
    h += '<div class="hr"></div>';
    if (s.bays.length >= loc.maxBays) {
      h += '<div class="note warn">This building only has room for ' + loc.maxBays + ' bays. Move to a bigger location to build more.</div>';
    } else {
      h += '<div class="spread"><div><strong>Build another bay</strong><div class="small muted">Adds a Level 1 stall. Remember a bay is worthless without a technician in it.</div></div>' +
        costBtn('build-bay', '', bayCost, 'Build Bay', s) + '</div>';
    }
    h += '</div>';

    /* parking */
    h += '<div class="card"><h3>The Lot <span class="pill">' + s.spaces + ' / ' + loc.maxSpaces + ' spaces</span></h3>' +
      '<div class="sub">A car occupies a space from the moment it arrives until the keys go back. When the lot is full you turn cars away at the driveway &mdash; and they remember.</div>';
    var lotHtml = '';
    for (var i = 0; i < s.spaces; i++) {
      var filled = i < s.wip.length;
      lotHtml += '<span style="display:inline-block;width:26px;height:38px;margin:3px;border-radius:4px;border:1px dashed ' +
        (filled ? '#916500' : '#3d4757') + ';background:' + (filled ? 'rgba(255,179,0,.18)' : '#12161d') +
        ';text-align:center;line-height:38px;font-size:16px">' + (filled ? '&#128663;' : '') + '</span>';
    }
    h += '<div style="margin-bottom:10px">' + lotHtml + '</div>';
    h += row('Held overnight (work in process)', s.wip.length);
    h += row('On the schedule tomorrow', s.booked.length);
    h += '<div class="hr"></div>';
    if (s.spaces >= loc.maxSpaces) {
      h += '<div class="note warn">No more room to pave at this location.</div>';
    } else {
      h += '<div class="spread"><div><strong>Pave another space</strong><div class="small muted">Striping, drainage and a bit more asphalt.</div></div>' +
        costBtn('buy-space', '', C.spaceCost, 'Add Space', s) + '</div>';
    }

    if (s.wip.length) {
      h += '<div class="hr"></div><h4>Cars Still Here</h4><div class="scroll"><table><thead><tr><th>Customer</th><th>Job</th><th class="n">Hours Left</th></tr></thead><tbody>';
      s.wip.forEach(function (w) {
        var j = AS.JOB_BY_ID[w.jobId];
        h += '<tr><td>' + esc(w.customer) + '</td><td>' + esc(j ? j.name : w.jobId) + '</td><td class="n">' + w.remaining.toFixed(1) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div></div>';

    /* capability matrix */
    h += '<div class="card" style="margin-top:16px"><h3>What You Can And Cannot Sell</h3>' +
      '<div class="sub">Green means at least one station has both the tooling and the qualified technician. Red is money walking back out the driveway.</div><div class="scroll">' +
      '<table><thead><tr><th>Job</th><th>Category</th><th class="n">Book Hrs</th><th class="n">Parts Cost</th><th class="n">Your Price</th><th>Needs</th><th>Status</th></tr></thead><tbody>';
    AS.JOBS.slice().sort(function (a, b) { return a.equip - b.equip || a.skill - b.skill || a.hours - b.hours; }).forEach(function (j) {
      var ok = built.stations.some(function (st) { return st.equip >= j.equip && st.skill >= j.skill; });
      var q = AS.quote(s, j);
      h += '<tr><td>' + esc(j.name) + '</td><td class="muted small">' + j.cat + '</td>' +
        '<td class="n">' + j.hours.toFixed(1) + '</td><td class="n">' + money(j.parts) + '</td>' +
        '<td class="n">' + money(q.total) + '</td>' +
        '<td class="small muted">Bay ' + j.equip + ' &middot; ' + AS.TECH_LEVELS[j.skill - 1].title + '</td>' +
        '<td>' + (ok ? '<span class="pill green">Can do</span>' : '<span class="pill red">Referred out</span>') + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  };

  /* ================= VIEW: CREW ================= */
  UI.views.crew = function (s) {
    var hours = AS.WEEK[s.dow].hours || 9;
    var h = '<div class="grid g2">';

    /* technicians */
    h += '<div class="card"><h3>Technicians <span class="pill">' + s.techs.length + '</span></h3>' +
      '<div class="sub">A technician&rsquo;s level gates the hardest job they may touch and how many book hours they turn per clock hour. Flat-rate efficiency above 100% is free money.</div>';
    s.techs.slice().sort(function (a, b) { return b.lvl - a.lvl; }).forEach(function (t) {
      var lv = AS.techLevel(t), next = AS.TECH_LEVELS[t.lvl];
      var unlocks = next ? AS.JOBS.filter(function (j) { return j.skill === next.lvl; }) : [];
      h += '<div class="unit"><div class="unit-ico">&#128104;&#8205;&#128295;</div><div class="unit-body">' +
        '<div class="unit-title">' + esc(t.name) + ' <span class="pill amber">' + lv.title + '</span>' +
        (t.training > 0 ? '<span class="pill blue">In training ' + t.training + 'd</span>' : '') + '</div>' +
        '<div class="unit-meta">' + (lv.eff * 100).toFixed(0) + '% flat-rate efficiency &middot; ' + money(lv.wage) + '/hr (' + money(lv.wage * hours) + '/day) &middot; comeback risk ' + (lv.comeback * 100).toFixed(1) + '%</div>' +
        ladder(t.lvl, 5) +
        '<div class="unit-meta">Morale ' + t.morale.toFixed(0) + ' &middot; Fatigue ' + t.fatigue.toFixed(0) + ' &middot; ' + t.lifetimeBilled.toFixed(0) + ' hours billed &middot; ' + t.comebacks + ' comebacks</div>' +
        (next ? '<div class="unit-meta">Training to <strong>' + next.title + '</strong>: ' + next.trainDays + ' days off the floor' +
          (unlocks.length ? ', unlocks ' + unlocks.map(function (j) { return esc(j.name); }).join(', ') : '') + '</div>' : '') +
        '</div><div class="unit-actions">' +
        (next && t.training <= 0 ? costBtn('train-tech', t.id, AS.TECH_LEVELS[t.lvl - 1].trainCost, 'Train', s) : next ? '' : '<span class="pill green">Master</span>') +
        '<button class="btn btn-sm btn-danger" data-action="fire-tech" data-id="' + t.id + '">Let Go</button>' +
        '</div></div>';
    });
    h += '<div class="hr"></div><h4>Hire A Technician</h4><div class="inline">';
    AS.TECH_LEVELS.forEach(function (lv, i) {
      var cost = lv.hireCost;
      h += '<button class="btn btn-sm" data-action="hire-tech" data-id="' + (i + 1) + '"' + (afford(s, cost) ? '' : ' disabled') + '>' +
        lv.title + '<br><span class="muted small">' + money(cost) + ' hire &middot; ' + money(lv.wage) + '/hr</span></button>';
    });
    h += '</div><div class="note small" style="margin-top:10px">Hiring is instant but costs a recruiting fee. Training an existing tech is cheaper per level than buying talent &mdash; but they are off the floor while they study.</div></div>';

    /* advisors */
    h += '<div class="card"><h3>Service Advisors <span class="pill">' + s.advisors.length + '</span></h3>' +
      '<div class="sub">The counter is where estimates become repair orders. Advisors cap how many customers you can handle in a day, how many approve the work, and how much extra gets sold per car.</div>';
    s.advisors.slice().sort(function (a, b) { return b.lvl - a.lvl; }).forEach(function (a) {
      var lv = AS.advisorLevel(a), next = AS.ADVISOR_LEVELS[a.lvl];
      var closeRate = a.lifetimeQuoted > 0 ? a.lifetimeSold / a.lifetimeQuoted : 0;
      h += '<div class="unit"><div class="unit-ico">&#128188;</div><div class="unit-body">' +
        '<div class="unit-title">' + esc(a.name) + ' <span class="pill amber">' + lv.title + '</span>' +
        (a.training > 0 ? '<span class="pill blue">In training ' + a.training + 'd</span>' : '') + '</div>' +
        '<div class="unit-meta">' + (lv.close * 100).toFixed(0) + '% base close rate &middot; ' + (lv.upsell * 100).toFixed(0) + '% upsell attempt &middot; ' +
        Math.round(lv.roCap * (hours / 9)) + ' customers/day &middot; ' + money(lv.wage) + '/day + ' + (lv.comm * 100).toFixed(0) + '% commission</div>' +
        ladder(a.lvl, 5) +
        '<div class="unit-meta">Morale ' + a.morale.toFixed(0) + ' &middot; ' + a.lifetimeRO + ' repair orders written &middot; ' + a.lifetimeUpsells + ' add-ons sold' +
        (a.lifetimeQuoted > 0 ? ' &middot; ' + AS.pct(closeRate, 0) + ' of quoted dollars captured' : '') + '</div>' +
        (next ? '<div class="unit-meta">Advanced sales training to <strong>' + next.title + '</strong>: ' + next.trainDays + ' days, close rate ' +
          (lv.close * 100).toFixed(0) + '% &rarr; ' + (next.close * 100).toFixed(0) + '%, upsell ' + (lv.upsell * 100).toFixed(0) + '% &rarr; ' + (next.upsell * 100).toFixed(0) + '%</div>' : '') +
        '</div><div class="unit-actions">' +
        (next && a.training <= 0 ? costBtn('train-advisor', a.id, AS.ADVISOR_LEVELS[a.lvl - 1].trainCost, 'Sales Training', s) : next ? '' : '<span class="pill green">Master</span>') +
        '<button class="btn btn-sm btn-danger" data-action="fire-advisor" data-id="' + a.id + '">Let Go</button>' +
        '</div></div>';
    });
    h += '<div class="hr"></div><h4>Hire An Advisor</h4><div class="inline">';
    AS.ADVISOR_LEVELS.forEach(function (lv, i) {
      var cost = lv.hireCost;
      h += '<button class="btn btn-sm" data-action="hire-advisor" data-id="' + (i + 1) + '"' + (afford(s, cost) ? '' : ' disabled') + '>' +
        lv.title + '<br><span class="muted small">' + money(cost) + ' hire &middot; ' + money(lv.wage) + '/day</span></button>';
    });
    h += '</div></div>';

    h += '</div>';

    /* payroll summary */
    var pay = AS.dailyPayroll(s, hours);
    h += '<div class="card" style="margin-top:16px"><h3>Payroll</h3><div class="grid g4">' +
      kpi('Technician Wages', money(pay.tech), 'per open day') +
      kpi('Advisor Salaries', money(pay.advisor), 'plus commission') +
      kpi('Total Daily Labor', money(pay.total)) +
      kpi('Break-even Billed Hours', ((pay.total + AS.dailyOverhead(s).total) / Math.max(1, s.pricing.laborRate)).toFixed(1), 'at your labor rate, ignoring parts gross') +
      '</div></div>';
    return h;
  };

  /* ================= VIEW: PRICING ================= */
  UI.views.pricing = function (s) {
    var p = s.pricing;
    var h = '<div class="grid g2">';

    h += '<div class="card"><h3>Rates &amp; Fees</h3>' +
      '<div class="sub">Town average labor rate is $' + C.marketLaborRate + '/hr. Price above it and you make more per car but close fewer estimates and slowly bleed reputation. Price below it and the lot fills with thin tickets.</div>' +

      '<label class="field"><span>Labor rate &mdash; $' + p.laborRate + ' per book hour</span>' +
      '<div class="slider-row"><input type="range" min="' + C.laborRateMin + '" max="' + C.laborRateMax + '" step="1" value="' + p.laborRate + '" data-action="set-labor"><input class="num" type="number" min="' + C.laborRateMin + '" max="' + C.laborRateMax + '" value="' + p.laborRate + '" data-action="set-labor"></div>' +
      '<div class="small muted">' + priceComment(p.laborRate) + '</div></label>' +

      '<label class="field"><span>Oil change price (your loss leader)</span>' +
      '<div class="slider-row"><input type="range" min="19" max="129" step="1" value="' + p.oilPrice.toFixed(0) + '" data-action="set-oil"><input class="num" type="number" min="19" max="129" step="1" value="' + p.oilPrice.toFixed(0) + '" data-action="set-oil"></div>' +
      '<div class="small muted">Town average is $' + C.marketOilPrice.toFixed(2) + '. Parts alone cost you ' + money(AS.partsPrice(s, 24)) + ' to sell. Cheap oil changes buy traffic you then have to upsell.</div></label>' +

      '<label class="field"><span>Diagnostic fee</span>' +
      '<div class="slider-row"><input type="range" min="0" max="260" step="5" value="' + p.diagFee + '" data-action="set-diag"><input class="num" type="number" min="0" max="260" step="5" value="' + p.diagFee + '" data-action="set-diag"></div>' +
      '<div class="small muted">Charged as the floor on diagnostic work. Free diagnosis pulls in tire-kickers and burns your best technician&rsquo;s hours.</div></label>' +

      '<label class="field"><span>Parts pricing strategy</span><select data-action="set-strategy">' +
      C.partsStrategies.map(function (st) {
        return '<option value="' + st.id + '"' + (st.id === p.partsStrategy ? ' selected' : '') + '>' + st.name + ' (' + Math.round((st.mult - 1) * 100) + '% vs matrix)</option>';
      }).join('') + '</select><div class="small muted">' + AS.partsStrategy(s).blurb + '</div></label>' +

      '<label class="field inline" style="margin-top:14px"><input type="checkbox" data-action="set-supply"' + (p.supplyFee ? ' checked' : '') + '> ' +
      '<span style="text-transform:none;letter-spacing:0;color:var(--ink);margin:0">Charge shop supplies fee (' + Math.round(C.supplyFeeRate * 100) + '% of labor, capped at ' + money(C.supplyFeeCap) + ')</span></label>' +
      '</div>';

    /* matrix + preview */
    h += '<div class="card"><h3>Parts Markup Matrix</h3>' +
      '<div class="sub">Real shops mark cheap parts up hard and expensive parts lightly. Nobody blinks at a $9 filter; everybody shops a $2,400 transmission.</div>' +
      '<div class="scroll"><table><thead><tr><th>Your Cost</th><th class="n">Multiplier</th><th class="n">Effective GP%</th></tr></thead><tbody>';
    var prev = 0;
    C.partsMatrix.forEach(function (m) {
      var mult = m.mult * AS.partsStrategy(s).mult;
      h += '<tr><td>' + money(prev) + ' &ndash; ' + (m.max > 1e8 ? 'up' : money(m.max)) + '</td>' +
        '<td class="n">' + mult.toFixed(2) + '&times;</td><td class="n">' + AS.pct(1 - 1 / mult, 0) + '</td></tr>';
      prev = m.max;
    });
    h += '</tbody></table></div>';

    h += '<div class="hr"></div><h4>Your Ticket vs The Town</h4><div class="scroll"><table><thead><tr><th>Job</th><th class="n">You</th><th class="n">Market</th><th class="n">Difference</th></tr></thead><tbody>';
    ['oil', 'brakes', 'align', 'cel', 'tires', 'suspension', 'timing'].forEach(function (id) {
      var j = AS.JOB_BY_ID[id], q = AS.quote(s, j), m = AS.marketQuote(s, j);
      var diff = (q.total - m) / m;
      h += '<tr><td>' + esc(j.name) + '</td><td class="n">' + money(q.total) + '</td><td class="n">' + money(m) + '</td>' +
        '<td class="n ' + (diff > 0.03 ? 'neg' : diff < -0.03 ? 'pos' : '') + '">' + (diff >= 0 ? '+' : '') + AS.pct(diff, 0) + '</td></tr>';
    });
    h += '</tbody></table></div></div>';

    h += '</div>';

    /* parts inventory */
    h += '<div class="card" style="margin-top:16px"><h3>Parts Inventory</h3>' +
      '<div class="sub">Stock is measured in dollars of parts on the shelf. A job whose parts cost more than you have on hand becomes a special order &mdash; one day later, and impatient customers cancel.</div>' +
      '<div class="grid g3">' +
      kpi('On Hand', money(s.partsStock)) +
      kpi('Auto-Order Up To', money(s.partsAutoOrder), 'restocked every night if cash allows') +
      kpi('Suggested Level', money(Math.round(estimateDailyParts(s) * 3)), 'about three days of consumption') +
      '</div>' +
      '<label class="field"><span>Nightly auto-order target</span>' +
      '<div class="slider-row"><input type="range" min="0" max="30000" step="250" value="' + s.partsAutoOrder + '" data-action="set-autoorder">' +
      '<input class="num" type="number" min="0" step="250" value="' + s.partsAutoOrder + '" data-action="set-autoorder"></div>' +
      '<div class="small muted">Inventory ties up cash. Too little and you lose sales to special orders; too much and you cannot make payroll.</div></label>' +
      '</div>';
    return h;
  };

  /* Long unlock lists get truncated so a card stays readable. */
  function nameList(jobs, max) {
    max = max || 3;
    var names = jobs.map(function (j) { return esc(j.name); });
    if (names.length <= max) return names.join(', ');
    return names.slice(0, max).join(', ') + ' and ' + (names.length - max) + ' more';
  }

  function priceComment(rate) {
    var d = (rate - C.marketLaborRate) / C.marketLaborRate;
    if (d > 0.22) return 'Well above the market. Expect a lot of "I need to think about it" and slow reputation decay.';
    if (d > 0.06) return 'Premium pricing. Fine if your reputation and your technicians can carry it.';
    if (d > -0.06) return 'Right at the market rate. Nobody argues, nobody raves.';
    if (d > -0.2) return 'Below market. You will close more work and make less on each hour of it.';
    return 'Deep discount. The phone rings constantly and the gross profit is not there.';
  }
  function estimateDailyParts(s) {
    var recent = s.history.slice(-7);
    if (!recent.length) return 1200;
    var avgRev = recent.reduce(function (n, h) { return n + h.revenue; }, 0) / recent.length;
    return Math.max(500, avgRev * 0.3);
  }

  /* ================= VIEW: MARKETING ================= */
  UI.views.marketing = function (s) {
    var total = Object.keys(s.adSpend).reduce(function (n, k) { return n + s.adSpend[k]; }, 0);
    var f = UI.forecast(s);
    var h = '<div class="card"><h3>Advertising <span class="pill amber">' + money(total) + ' / day</span></h3>' +
      '<div class="sub">Spending builds an <em>awareness stock</em> for each channel. Stock decays every day &mdash; slowly for brand channels, fast for search. Doubling spend does not double leads; each channel has diminishing returns.</div>';

    var lastDay = s.history.length ? s.lastDayDetail : null;
    h += '<div class="grid g2">';
    AS.CHANNELS.forEach(function (ch) {
      var st = s.channels[ch.id];
      var spend = s.adSpend[ch.id] || 0;
      var leadsNow = (f.sources.filter(function (x) { return x.id === ch.id; })[0] || { leads: 0 }).leads;
      var cpl = leadsNow > 0.05 ? spend / leadsNow : 0;
      h += '<div class="card tight" style="background:var(--panel2)">' +
        '<div class="spread"><strong>' + ch.name + '</strong><span class="pill ' + (spend > 0 ? 'amber' : '') + '">' + money(spend) + '/day</span></div>' +
        '<div class="small muted" style="margin:4px 0 8px">' + ch.blurb + '</div>' +
        '<div class="slider-row"><input type="range" min="0" max="1200" step="5" value="' + spend + '" data-action="set-ad" data-id="' + ch.id + '">' +
        '<input class="num" type="number" min="0" step="5" value="' + spend + '" data-action="set-ad" data-id="' + ch.id + '"></div>' +
        '<div class="small muted" style="margin-top:6px">Awareness stock ' + st.stock.toFixed(2) + ' &middot; carries ' + Math.round(ch.decay * 100) + '% overnight</div>' +
        bar(Math.min(1, st.stock / 12), 'b') +
        '<div class="minirow">' +
        mini('Leads/day', leadsNow.toFixed(1)) +
        mini('Cost/lead', cpl ? money(cpl) : '—') +
        mini('Intent', Math.round(ch.quality * 100) + '%') +
        mini('Coupon', ch.coupon ? Math.round(ch.coupon * 100) + '%' : 'none') +
        '</div></div>';
    });
    h += '</div>';

    h += '<div class="hr"></div><div class="note info">Two channels do not buy leads directly. The <em>Review &amp; Reputation Program</em> raises your reputation every day it runs, which lifts all organic traffic. The <em>Loyalty &amp; Reminder Program</em> shortens the interval between visits from the ' + Math.round(s.customerBase).toLocaleString() + ' customers who already know you.</div>';

    h += '</div>';

    /* performance history */
    if (s.adHistory && s.adHistory.length) {
      h += '<div class="card" style="margin-top:16px"><h3>Channel Performance (last 14 open days)</h3><div class="scroll">' +
        '<table><thead><tr><th>Channel</th><th class="n">Spend</th><th class="n">Leads</th><th class="n">Repair Orders</th><th class="n">Revenue</th><th class="n">Gross Profit</th><th class="n">Return On Spend</th></tr></thead><tbody>';
      var agg = {};
      s.adHistory.slice(-14).forEach(function (rec) {
        Object.keys(rec).forEach(function (k) {
          if (k === 'day') return;
          agg[k] = agg[k] || { spend: 0, leads: 0, ros: 0, revenue: 0, gp: 0 };
          agg[k].spend += rec[k].spend || 0; agg[k].leads += rec[k].leads || 0;
          agg[k].ros += rec[k].ros || 0; agg[k].revenue += rec[k].revenue || 0; agg[k].gp += rec[k].gp || 0;
        });
      });
      Object.keys(agg).forEach(function (k) {
        var a = agg[k];
        var name = k === 'organic' ? 'Drive-by &amp; word of mouth' : k === 'repeat' ? 'Returning customers' : (AS.CHANNEL_BY_ID[k] ? AS.CHANNEL_BY_ID[k].name : k);
        var roas = a.spend > 0 ? a.gp / a.spend : null;
        h += '<tr><td>' + name + '</td><td class="n">' + money(a.spend) + '</td><td class="n">' + Math.round(a.leads) + '</td>' +
          '<td class="n">' + a.ros + '</td><td class="n">' + money(a.revenue) + '</td><td class="n">' + money(a.gp) + '</td>' +
          '<td class="n ' + (roas == null ? '' : roas >= 1 ? 'pos' : 'neg') + '">' + (roas == null ? 'free' : roas.toFixed(2) + '&times;') + '</td></tr>';
      });
      h += '</tbody></table></div><div class="small muted" style="margin-top:8px">Return on spend compares gross profit (revenue minus parts cost) to advertising dollars. Under 1.00&times; that channel is not paying for itself &mdash; and it still has to cover wages and rent.</div></div>';
    }
    return h;
  };

  /* ================= VIEW: BOOKS ================= */
  UI.views.books = function (s) {
    var hist = s.history;
    var last7 = hist.slice(-7), last30 = hist.slice(-30);
    function sum(a, k) { return a.reduce(function (n, x) { return n + x[k]; }, 0); }
    /* Sundays would drag every average to zero, so utilization counts open days. */
    function avgUtil(a) {
      var open = a.filter(function (x) { return x.open !== false; });
      return open.length ? sum(open, 'util') / open.length : 0;
    }
    var h = '';

    h += '<div class="grid g4">' +
      kpi('7-Day Revenue', money(sum(last7, 'revenue'))) +
      kpi('7-Day Net', money(sum(last7, 'net')), '', cls(sum(last7, 'net'))) +
      kpi('7-Day Cars', sum(last7, 'cars')) +
      kpi('7-Day ARO', money(sum(last7, 'cars') ? sum(last7, 'revenue') / sum(last7, 'cars') : 0)) +
      kpi('Billed Hours (7d)', sum(last7, 'billed').toFixed(1)) +
      kpi('Avg Utilization', AS.pct(avgUtil(last7), 0), 'open days only') +
      kpi('Lifetime Revenue', money(s.stats.totalRevenue)) +
      kpi('Lifetime Net', money(s.stats.totalProfit), '', cls(s.stats.totalProfit)) +
      '</div>';

    if (hist.length > 1) {
      h += '<div class="grid g2" style="margin-top:16px">' +
        '<div class="card"><h3>Revenue &amp; Net Profit</h3>' + lineChart(hist.slice(-60), ['revenue', 'net'], ['#ffb300', '#3ecf8e']) +
        '<div class="legend"><span><i style="background:#ffb300"></i>Revenue</span><span><i style="background:#3ecf8e"></i>Net profit</span></div></div>' +
        '<div class="card"><h3>Cash Position</h3>' + lineChart(hist.slice(-60), ['cash'], ['#4aa8ff']) +
        '<div class="legend"><span><i style="background:#4aa8ff"></i>Cash on hand</span></div></div>' +
        '</div>';
    }

    /* daily ledger */
    h += '<div class="card" style="margin-top:16px"><h3>Daily Ledger <span class="muted small">last 30 days</span></h3><div class="scroll">' +
      '<table><thead><tr><th class="n">Day</th><th class="n">Cars</th><th class="n">Billed Hrs</th><th class="n">Revenue</th><th class="n">Gross Profit</th><th class="n">Net</th><th class="n">ARO</th><th class="n">Util</th><th class="n">Rep</th><th class="n">Cash</th></tr></thead><tbody>';
    last30.slice().reverse().forEach(function (d) {
      h += '<tr><td class="n">' + d.day + '</td><td class="n">' + d.cars + '</td><td class="n">' + d.billed.toFixed(1) + '</td>' +
        '<td class="n">' + money(d.revenue) + '</td><td class="n">' + money(d.gp) + '</td>' +
        '<td class="n ' + cls(d.net) + '">' + money(d.net) + '</td><td class="n">' + money(d.aro) + '</td>' +
        '<td class="n">' + AS.pct(d.util, 0) + '</td><td class="n">' + d.rep.toFixed(0) + '</td><td class="n">' + money(d.cash) + '</td></tr>';
    });
    h += '</tbody></table></div></div>';

    /* milestones */
    h += '<div class="card" style="margin-top:16px"><h3>Milestones</h3><div class="grid g2">';
    AS.MILESTONES.forEach(function (m) {
      var done = s.milestones[m.id];
      h += '<div class="unit" style="margin-bottom:0"><div class="unit-ico">' + (done ? '&#9989;' : '&#9675;') + '</div>' +
        '<div class="unit-body"><div class="unit-title">' + m.name + (done ? ' <span class="pill green">Day ' + done + '</span>' : '') + '</div>' +
        '<div class="unit-meta">' + m.blurb + (m.reward ? ' &middot; reward ' + money(m.reward) : '') + '</div></div></div>';
    });
    h += '</div></div>';
    return h;
  };

  function lineChart(data, keys, colors) {
    if (!data.length) return '<div class="muted small">No data yet.</div>';
    var W = 520, H = 150, pad = 6;
    var all = [];
    keys.forEach(function (k) { data.forEach(function (d) { all.push(d[k]); }); });
    var min = Math.min.apply(null, all.concat([0])), max = Math.max.apply(null, all.concat([1]));
    var rng = (max - min) || 1;
    function x(i) { return pad + i * (W - pad * 2) / Math.max(1, data.length - 1); }
    function y(v) { return H - pad - (v - min) / rng * (H - pad * 2); }
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    svg += '<line class="grid-l" x1="0" y1="' + y(0).toFixed(1) + '" x2="' + W + '" y2="' + y(0).toFixed(1) + '"/>';
    keys.forEach(function (k, ki) {
      var pts = data.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d[k]).toFixed(1); }).join(' ');
      svg += '<polyline fill="none" stroke="' + colors[ki] + '" stroke-width="2" stroke-linejoin="round" points="' + pts + '"/>';
    });
    return svg + '</svg>';
  }

  /* ================= VIEW: EXPAND ================= */
  UI.views.expand = function (s) {
    var loc = AS.location(s), next = AS.LOCATIONS[s.locIndex + 1];
    var limit = AS.creditLimit(s);
    var h = '<div class="grid g2">';

    h += '<div class="card"><h3>Location</h3>' +
      '<div class="sub">Location sets the raw traffic that drives past your sign every day. It is the single biggest lever in the game &mdash; and the most expensive.</div>' +
      '<div class="unit"><div class="unit-ico">&#127959;</div><div class="unit-body">' +
      '<div class="unit-title">' + loc.name + ' <span class="pill green">Current</span></div>' +
      '<div class="unit-meta">' + loc.blurb + '</div>' +
      '<div class="unit-meta">Base traffic ' + loc.base.toFixed(0) + '/day &middot; rent ' + money(loc.rent) + '/day &middot; up to ' + loc.maxBays + ' bays and ' + loc.maxSpaces + ' parking spaces</div>' +
      '</div></div>';
    if (next) {
      h += '<div class="unit"><div class="unit-ico">&#128506;</div><div class="unit-body">' +
        '<div class="unit-title">' + next.name + '</div><div class="unit-meta">' + next.blurb + '</div>' +
        '<div class="unit-meta">Base traffic ' + next.base.toFixed(0) + '/day (+' + Math.round((next.base / loc.base - 1) * 100) + '%) &middot; rent ' + money(next.rent) + '/day &middot; up to ' + next.maxBays + ' bays, ' + next.maxSpaces + ' spaces</div>' +
        '<div class="unit-meta warnc">Moving costs you one day of business.</div></div>' +
        '<div class="unit-actions">' + costBtn('move', '', next.cost, 'Move', s) + '</div></div>';
    } else {
      h += '<div class="note good">You are on the best corner in the county.</div>';
    }
    h += '</div>';

    h += '<div class="card"><h3>Financing</h3>' +
      '<div class="sub">Borrow against your equipment and location. Interest accrues daily at ' + AS.pct(C.loanAPR, 1) + ' APR and is charged whether the doors are open or not.</div>' +
      '<div class="grid g3">' +
      kpi('Cash', money(s.cash), '', cls(s.cash)) +
      kpi('Outstanding Loan', money(s.loan)) +
      kpi('Credit Limit', money(limit), 'bankruptcy below this') +
      '</div><div class="hr"></div>' +
      '<div class="inline">' +
      [5000, 25000, 50000, 100000].map(function (amt) {
        return '<button class="btn btn-sm" data-action="borrow" data-id="' + amt + '">Borrow ' + money(amt) + '</button>';
      }).join('') + '</div>' +
      '<div class="inline" style="margin-top:8px">' +
      [5000, 25000, 50000].map(function (amt) {
        return '<button class="btn btn-sm" data-action="repay" data-id="' + amt + '"' + (s.loan <= 0 || s.cash < Math.min(amt, s.loan) ? ' disabled' : '') + '>Repay ' + money(amt) + '</button>';
      }).join('') +
      '<button class="btn btn-sm" data-action="repay" data-id="all"' + (s.loan <= 0 || s.cash < s.loan ? ' disabled' : '') + '>Repay In Full</button>' +
      '</div>' +
      '<div class="note small" style="margin-top:12px">Daily interest at the current balance: ' + money(s.loan * C.loanAPR / 365) + '</div>' +
      '</div>';

    h += '</div>';

    /* buy list */
    h += '<div class="card" style="margin-top:16px"><h3>Capital Shopping List</h3>' +
      '<div class="sub">What each dollar actually buys you.</div><div class="scroll">' +
      '<table><thead><tr><th>Investment</th><th class="n">Cost</th><th>What It Does</th><th></th></tr></thead><tbody>';
    var bayCost = AS.bayBuildCost(s);
    h += '<tr><td>New service bay</td><td class="n">' + money(bayCost) + '</td><td class="small muted">Adds a Level 1 stall. Needs a technician to be worth anything.</td>' +
      '<td>' + (s.bays.length >= loc.maxBays ? '<span class="pill red">At capacity</span>' : costBtn('build-bay', '', bayCost, 'Build', s)) + '</td></tr>';
    h += '<tr><td>Parking space</td><td class="n">' + money(C.spaceCost) + '</td><td class="small muted">One more car you can physically accept on a busy day.</td>' +
      '<td>' + (s.spaces >= loc.maxSpaces ? '<span class="pill red">At capacity</span>' : costBtn('buy-space', '', C.spaceCost, 'Pave', s)) + '</td></tr>';
    AS.EQUIP.slice(1).forEach(function (eq) {
      var candidates = s.bays.filter(function (b) { return b.lvl === eq.lvl - 1; });
      var unlocks = AS.JOBS.filter(function (j) { return j.equip === eq.lvl; });
      h += '<tr><td>Upgrade a bay to ' + eq.name + '</td><td class="n">' + money(eq.cost) + '</td>' +
        '<td class="small muted">' + eq.blurb + (unlocks.length ? ' Unlocks ' + unlocks.map(function (j) { return j.name; }).join(', ') + '.' : '') + '</td>' +
        '<td>' + (candidates.length ? costBtn('upgrade-bay', candidates[0].id, eq.cost, 'Upgrade', s) : '<span class="muted small">no eligible bay</span>') + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  };

  /* ================= VIEW: MANUAL ================= */
  UI.views.help = function (s) {
    return '' +
    '<div class="grid g2">' +
    '<div class="card"><h3>How A Day Works</h3><ul class="clean">' +
    '<li>Cars arrive hour by hour from drive-by traffic, returning customers and each advertising channel you fund.</li>' +
    '<li>If the <strong>lot is full</strong>, the car never comes in. If <strong>every advisor is buried</strong>, the customer waits, then leaves.</li>' +
    '<li>An advisor writes the estimate. Whether it is approved depends on their sales training, your price against the town average, your reputation, and how badly the car needs the work.</li>' +
    '<li>Approved work is dispatched to a <strong>station</strong> &mdash; a bay paired with a technician. The bay must have the tooling; the technician must hold the ticket.</li>' +
    '<li>Work that does not finish by close stays overnight, occupying a parking space and eating tomorrow&rsquo;s hours first.</li>' +
    '<li>You bill <strong>book hours</strong>, not clock hours. A Master Tech billing 1.45 hours for every hour on the clock is where a shop actually makes money.</li>' +
    '</ul></div>' +

    '<div class="card"><h3>The Four Constraints</h3><ul class="clean">' +
    '<li><strong>Parking spaces</strong> cap how many cars can be on the property at once.</li>' +
    '<li><strong>Service advisors</strong> cap how many customers get handled, and how much of what they are shown gets sold.</li>' +
    '<li><strong>Bays</strong> cap capacity, and their <strong>equipment level</strong> caps what work is physically possible.</li>' +
    '<li><strong>Technicians</strong> cap capacity too &mdash; a bay without a tech produces nothing &mdash; and their <strong>skill level</strong> caps what work is legal to attempt.</li>' +
    '</ul><div class="note warn">Whichever of these is tightest is the only one worth spending money on. Buying a fifth bay when you have three technicians just adds upkeep.</div></div>' +

    '<div class="card"><h3>Reading Your Numbers</h3><ul class="clean">' +
    '<li><strong>Car count</strong> &mdash; repair orders written today.</li>' +
    '<li><strong>ARO</strong> &mdash; average repair order. Total revenue divided by cars. Driven by your job mix and your advisors&rsquo; upselling.</li>' +
    '<li><strong>Effective labor rate</strong> &mdash; labor revenue divided by billed hours. Discounted oil changes drag this below your posted rate.</li>' +
    '<li><strong>Productivity</strong> &mdash; clock hours worked over clock hours available. Are your people busy?</li>' +
    '<li><strong>Efficiency</strong> &mdash; book hours billed over clock hours worked. Are your people fast?</li>' +
    '<li><strong>Parts gross profit</strong> &mdash; healthy independents run 40&ndash;50% on parts and near 100% on labor before wages.</li>' +
    '<li><strong>Comebacks</strong> &mdash; work redone free. They cost hours, reputation and morale all at once.</li>' +
    '</ul></div>' +

    '<div class="card"><h3>Advertising</h3><ul class="clean">' +
    '<li>Each channel accumulates an <strong>awareness stock</strong>. Search decays fast (34% carries over) &mdash; stop paying and the phone stops today. Radio carries 89% &mdash; it takes weeks to build and weeks to fade.</li>' +
    '<li>Returns diminish: doubling spend on one channel gives roughly 1.5&times; the reach, not 2&times;.</li>' +
    '<li>Channels differ in <strong>intent</strong>. Search traffic closes better and skews toward repairs. Mail coupons close fine but arrive with a discount and want maintenance.</li>' +
    '<li>The two program channels do not buy leads. Reviews raise reputation, which raises all organic traffic forever. Loyalty shortens the return interval of customers you already earned.</li>' +
    '<li>Judge a channel on <strong>gross profit return on spend</strong> in the Marketing tab, not on lead count.</li>' +
    '</ul></div>' +

    '<div class="card"><h3>People</h3><ul class="clean">' +
    '<li><strong>Training</strong> costs money and takes the person off the floor for several days. It is cheaper per level than hiring talent outright.</li>' +
    '<li><strong>Advanced sales training</strong> for advisors raises close rate, upsell rate and how many customers they can handle. It is usually the highest-return training in the game.</li>' +
    '<li><strong>Morale</strong> falls when the shop is dead (flat-rate techs earn nothing) and when it is pinned at 100% for days. <strong>Fatigue</strong> slows people down.</li>' +
    '<li>Higher-level technicians produce more billed hours per clock hour and generate far fewer comebacks.</li>' +
    '</ul></div>' +

    '<div class="card"><h3>Pricing</h3><ul class="clean">' +
    '<li>Your labor rate against the town average of $' + C.marketLaborRate + ' shifts both close rate and how many people bother driving in.</li>' +
    '<li>Cheap oil changes are a traffic purchase, not a profit centre. They only pay off if your advisors convert the inspection into real work.</li>' +
    '<li>The parts matrix marks cheap parts up hard and expensive parts lightly. Premium pricing adds gross but costs closes and reputation.</li>' +
    '<li>A diagnostic fee protects your best technician&rsquo;s hours from free-estimate shoppers.</li>' +
    '</ul></div>' +
    '</div>' +

    '<div class="card" style="margin-top:16px"><h3>Save Data</h3>' +
    '<div class="sub">The game saves to this browser automatically after every day.</div>' +
    '<div class="inline">' +
    '<button class="btn" data-action="export">Export Save Code</button>' +
    '<button class="btn" data-action="import">Import Save Code</button>' +
    '<button class="btn btn-danger" data-action="restart">Start A New Shop</button>' +
    '</div></div>';
  };

  /* ================= DAY REPORT ================= */
  UI.dayReport = function (s, d) {
    var h = '';
    if (d.isClosed) {
      h += '<div class="note info">Closed Sunday. Rent, insurance, interest and advertising still ran: ' + money(d.expenses) + '.</div>';
      return h;
    }

    h += '<div class="spread" style="margin-bottom:14px">' +
      '<div><span class="pill amber">' + d.weather.name + '</span> <span class="muted small">' + d.weather.note + '</span></div>' +
      '<div class="mono">' + Math.round(d.leads) + ' opportunities &middot; ' + d.ros + ' repair orders</div></div>';

    h += '<div class="grid g4">' +
      kpi('Revenue', money(d.revenue)) +
      kpi('Gross Profit', money(d.grossProfit), AS.pct(d.revenue ? d.grossProfit / d.revenue : 0, 0) + ' margin') +
      kpi('Net Profit', money(d.net), 'after every bill', cls(d.net)) +
      kpi('Cars Out', d.ros, d.carryover ? d.carryover + ' still on the lot' : 'nothing left overnight') +
      kpi('ARO', money(d.aro), 'average repair order') +
      kpi('Effective Labor Rate', money(d.elr), 'posted $' + s.pricing.laborRate) +
      kpi('Billed Hours', d.billedHours.toFixed(1), 'of ' + d.stationHours.toFixed(1) + ' available') +
      kpi('Close Rate', AS.pct(d.closeRate, 0), d.lost + ' estimates lost') +
      '</div>';

    /* leaks */
    var leaks = [];
    if (d.turnedAway) leaks.push(['bad', d.turnedAway + ' car' + (d.turnedAway > 1 ? 's' : '') + ' turned away at the driveway — the lot was full.']);
    if (d.balked) leaks.push(['warn', d.balked + ' customer' + (d.balked > 1 ? 's' : '') + ' left without being helped — the counter was overwhelmed.']);
    if (d.declined) leaks.push(['warn', d.declined + ' job' + (d.declined > 1 ? 's' : '') + ' worth ' + money(d.declinedValue) + ' referred out — you did not have the equipment or the qualified technician.']);
    if (d.rushParts) leaks.push(['warn', money(d.rushParts) + ' of parts had to be rush-ordered because they were not on your shelf, costing ' + money(d.rushFees) + ' in supplier premiums.']);
    if (d.stockouts) leaks.push(['bad', d.stockouts + ' job' + (d.stockouts > 1 ? 's' : '') + ' stalled — no parts on hand and no cash to buy them.']);
    if (d.cancellations) leaks.push(['bad', d.cancellations + ' customer' + (d.cancellations > 1 ? 's' : '') + ' who had been waiting on your schedule cancelled.']);
    if (d.comebacks) leaks.push(['bad', d.comebacks + ' comeback' + (d.comebacks > 1 ? 's' : '') + ' redone free of charge.']);
    if (d.booked) leaks.push(['info', d.booked + ' customer' + (d.booked > 1 ? 's' : '') + ' booked for tomorrow — you were out of capacity.']);
    if (leaks.length) {
      h += '<h3 style="margin-top:18px">Where The Money Leaked</h3>';
      leaks.forEach(function (l) { h += '<div class="note ' + l[0] + '">' + l[1] + '</div>'; });
    }

    /* P&L */
    h += '<div class="grid g2" style="margin-top:18px">';
    h += '<div class="card"><h3>Profit &amp; Loss</h3>' +
      row('Labor revenue', money(d.revLabor)) +
      row('Parts revenue', money(d.revParts)) +
      row('Shop supplies', money(d.revSupplies)) +
      (d.discounts ? row('Coupons honored', '-' + money(d.discounts), 'neg') : '') +
      row('<strong>Total revenue</strong>', '<strong>' + money(d.revenue) + '</strong>') +
      row('Parts cost', '-' + money(d.partsCost), 'neg') +
      row('<strong>Gross profit</strong>', '<strong class="pos">' + money(d.grossProfit) + '</strong>') +
      '<div class="hr"></div>' +
      row('Technician &amp; advisor wages', '-' + money(d.payroll), 'neg') +
      row('Advisor commission', '-' + money(d.commission), 'neg') +
      row('Rent, utilities, insurance, upkeep, interest', '-' + money(d.overhead), 'neg') +
      row('Advertising', '-' + money(d.adSpend), 'neg') +
      (d.rushFees ? row('Rush parts premium <span class="muted small">(stock more inventory)</span>', '-' + money(d.rushFees), 'neg') : '') +
      (d.otherCost - (d.rushFees || 0) > 0.5 ? row('Other', '-' + money(d.otherCost - (d.rushFees || 0)), 'neg') : '') +
      row('<strong>Net profit</strong>', '<strong class="' + cls(d.net) + '">' + money(d.net) + '</strong>') +
      (d.partsOrdered ? '<div class="hr"></div>' + row('Parts restocked tonight (cash out, inventory in)', '-' + money(d.partsOrdered), 'neg') : '') +
      '</div>';

    /* stations */
    h += '<div class="card"><h3>Station Performance</h3>' +
      '<div class="sub">Productivity is how busy they were. Efficiency is how fast they were.</div>' +
      '<div class="scroll"><table><thead><tr><th>Bay</th><th>Tech</th><th class="n">Clock</th><th class="n">Billed</th><th class="n">Prod.</th><th class="n">Eff.</th></tr></thead><tbody>';
    d.byStation.forEach(function (st) {
      h += '<tr><td>Lvl ' + st.bayLvl + '</td><td>' + esc(st.tech) + '</td>' +
        '<td class="n">' + st.clock.toFixed(1) + '</td><td class="n">' + st.billed.toFixed(1) + '</td>' +
        '<td class="n">' + AS.pct(st.productivity, 0) + '</td>' +
        '<td class="n ' + (st.efficiency >= 1 ? 'pos' : st.efficiency > 0 ? 'neg' : '') + '">' + (st.clock > 0 ? AS.pct(st.efficiency, 0) : '—') + '</td></tr>';
    });
    if (!d.byStation.length) h += '<tr><td colspan="6" class="muted">No stations ran today.</td></tr>';
    h += '</tbody></table></div>';
    h += '<div class="hr"></div>' +
      row('Peak cars on the lot', (d.peakLot || 0) + ' of ' + s.spaces) +
      row('Add-ons sold', d.upsells) +
      row('Reputation change', (d.repDelta >= 0 ? '+' : '') + d.repDelta.toFixed(2), cls(d.repDelta)) +
      row('Loyal customers gained', '+' + Math.round(d.baseDelta));
    h += '</div></div>';

    /* by source */
    var srcRows = Object.keys(d.bySource).filter(function (k) { return d.bySource[k].leads || d.bySource[k].ros; });
    if (srcRows.length) {
      h += '<div class="card" style="margin-top:16px"><h3>Lead Sources</h3><div class="scroll"><table>' +
        '<thead><tr><th>Source</th><th class="n">Leads</th><th class="n">Repair Orders</th><th class="n">Revenue</th><th class="n">Gross Profit</th><th class="n">Ad Spend</th><th class="n">Return</th></tr></thead><tbody>';
      srcRows.sort(function (a, b) { return d.bySource[b].revenue - d.bySource[a].revenue; }).forEach(function (k) {
        var x = d.bySource[k];
        var name = k === 'organic' ? 'Drive-by &amp; word of mouth' : k === 'repeat' ? 'Returning customers' : (AS.CHANNEL_BY_ID[k] ? AS.CHANNEL_BY_ID[k].name : k);
        var roas = x.spend > 0 ? x.gp / x.spend : null;
        h += '<tr><td>' + name + '</td><td class="n">' + x.leads + '</td><td class="n">' + x.ros + '</td>' +
          '<td class="n">' + money(x.revenue) + '</td><td class="n">' + money(x.gp) + '</td>' +
          '<td class="n">' + (x.spend ? money(x.spend) : '—') + '</td>' +
          '<td class="n ' + (roas == null ? '' : roas >= 1 ? 'pos' : 'neg') + '">' + (roas == null ? 'free' : roas.toFixed(2) + '&times;') + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
    }

    /* jobs sold */
    var jobIds = Object.keys(d.byJob);
    if (jobIds.length) {
      h += '<div class="card" style="margin-top:16px"><h3>Work Sold</h3><div class="scroll"><table>' +
        '<thead><tr><th>Job</th><th class="n">Count</th><th class="n">Book Hours</th><th class="n">Revenue</th></tr></thead><tbody>';
      jobIds.sort(function (a, b) { return d.byJob[b].revenue - d.byJob[a].revenue; }).forEach(function (id) {
        var x = d.byJob[id];
        h += '<tr><td>' + esc(AS.JOB_BY_ID[id].name) + '</td><td class="n">' + x.count + '</td>' +
          '<td class="n">' + x.hours.toFixed(1) + '</td><td class="n">' + money(x.revenue) + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
    }

    /* the log */
    if (d.log.length) {
      h += '<div class="card" style="margin-top:16px"><h3>The Day, As It Happened</h3><div class="log">';
      d.log.forEach(function (l) {
        h += '<div class="log-line ' + (l.type || 'info') + '"><span class="log-time">' + (l.h == null ? '—' : clockTime(l.h)) + '</span>' +
          '<span class="log-text">' + l.text + '</span></div>';
      });
      h += '</div></div>';
    }

    /* milestones + event */
    if (d.milestones && d.milestones.length) {
      d.milestones.forEach(function (m) {
        h += '<div class="note good" style="margin-top:12px"><strong>Milestone reached &mdash; ' + m.name + '</strong><br>' + m.blurb +
          (m.reward ? ' Bonus: ' + money(m.reward) + '.' : '') + '</div>';
      });
    }
    return h;
  };

  /* ================= plumbing ================= */
  UI.render = function (s) {
    UI.renderHeader(s);
    var view = UI.views[UI.tab] || UI.views.office;
    $('#view').innerHTML = view(s);
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) {
      t.classList.toggle('active', t.dataset.tab === UI.tab);
    });
    var cap = UI.capacity(s);
    var warn = UI.warnings(s).filter(function (w) { return w[0] === 'bad'; });
    $('#dayHint').innerHTML = warn.length
      ? '<span class="neg">' + warn[0][1] + '</span>'
      : AS.WEEK[s.dow].open
        ? cap.stations.length + ' station' + (cap.stations.length === 1 ? '' : 's') + ' ready &middot; ' + cap.sellable.toFixed(1) + ' sellable hours &middot; counter can handle ' + cap.advCap + ' customers'
        : 'Closed today. Bills still run.';
    $('#btnOpenShop').textContent = AS.WEEK[s.dow].open ? 'Open The Shop →' : 'Skip To Monday →';
  };

  UI.modal = function (title, body, foot) {
    $('#modalTitle').innerHTML = title;
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML = foot || '<button class="btn btn-primary" data-action="close-modal">Close</button>';
    $('#modalWrap').hidden = false;
    $('#modalWrap').scrollTop = 0;
  };
  UI.closeModal = function () { $('#modalWrap').hidden = true; };

  UI.toast = function (msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = msg;
    $('#toasts').appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s'; el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 320);
    }, 3600);
  };

})(typeof window !== 'undefined' ? window : globalThis);
