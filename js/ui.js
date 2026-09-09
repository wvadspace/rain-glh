/*
 * Torque & Turnover — interface layer.
 * Renders from state, never mutates it directly: every change goes through
 * an engine action so the simulation stays the single source of truth.
 */
(function (root) {
  'use strict';

  var D = root.AutoShopData;
  var E = root.AutoShopEngine;

  var UI = {
    state: null,
    tab: 'dash',
    lastResult: null,
    toastTimer: null,
    modal: null
  };

  /* ---------------------------------------------------------------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) { return E.fmtMoney(v); }
  function money2(v) {
    var n = Math.round(v);
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US');
  }
  function pct(v, dp) { return (v * 100).toFixed(dp === undefined ? 0 : dp) + '%'; }
  function num(v, dp) { return Number(v).toFixed(dp === undefined ? 1 : dp); }
  function stars(rep) {
    var full = Math.floor(rep), half = rep - full >= 0.5;
    var s = '';
    for (var i = 0; i < 5; i++) s += i < full ? '★' : (i === full && half ? '⯨' : '☆');
    return s;
  }
  function pips(n, max, cls) {
    var out = '<div class="pips">';
    for (var i = 0; i < max; i++) out += '<i class="' + (i < n ? (cls || 'on') : '') + '"></i>';
    return out + '</div>';
  }
  function bar(frac, cls) {
    var f = Math.max(0, Math.min(1, frac || 0));
    return '<div class="bar"><i class="' + (cls || '') + '" style="width:' + (f * 100).toFixed(1) + '%"></i></div>';
  }

  function toast(msg, bad) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (bad ? ' bad' : '');
    el.style.display = 'block';
    clearTimeout(UI.toastTimer);
    UI.toastTimer = setTimeout(function () { el.style.display = 'none'; }, 2600);
  }
  function result(r) {
    if (!r) return;
    toast(r.msg, !r.ok);
    if (r.ok) render();
  }

  /* Simple SVG sparkline. series = [{data:[], color:'', fill:bool}] */
  function spark(series, height) {
    height = height || 62;
    var all = [];
    series.forEach(function (s) { all = all.concat(s.data); });
    if (!all.length) return '<div class="muted small">No data yet.</div>';
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    if (min > 0) min = 0;
    if (max === min) max = min + 1;
    var n = Math.max.apply(null, series.map(function (s) { return s.data.length; }));
    var w = 300, pad = 3;
    var out = '<svg class="spark" viewBox="0 0 ' + w + ' ' + height + '" preserveAspectRatio="none">';
    if (min < 0) {
      var zy = pad + (1 - (0 - min) / (max - min)) * (height - pad * 2);
      out += '<line x1="0" y1="' + zy.toFixed(1) + '" x2="' + w + '" y2="' + zy.toFixed(1) +
        '" stroke="#3a4152" stroke-width="1" stroke-dasharray="3 3"/>';
    }
    series.forEach(function (s) {
      if (!s.data.length) return;
      var pts = s.data.map(function (v, i) {
        var x = s.data.length === 1 ? w : (i / (n - 1 || 1)) * w;
        var y = pad + (1 - (v - min) / (max - min)) * (height - pad * 2);
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
      if (s.fill) {
        out += '<polygon points="0,' + height + ' ' + pts + ' ' + w + ',' + height +
          '" fill="' + s.color + '" opacity=".14"/>';
      }
      out += '<polyline points="' + pts + '" fill="none" stroke="' + s.color +
        '" stroke-width="1.8" stroke-linejoin="round"/>';
    });
    return out + '</svg>';
  }

  /* ---------------------------------------------------------------- *
   * Header
   * ---------------------------------------------------------------- */
  function renderHeader(office) {
    var s = UI.state;
    var cal = E.calendar(s.day);
    var label = 'Day ' + s.day + ' — ' + cal.label;

    /*
     * The whole day is simulated the moment you unlock the door, so during
     * playback the header has to be walked forward from a start-of-day
     * snapshot — otherwise it quietly spoils the ending.
     */
    var cash = s.cash, debt = s.debt, rep = s.reputation, custs = s.customerBase;
    var onSite = E.carsOnSite(s);
    if (UI.play && UI.play.snapshot) {
      var snap = UI.play.snapshot;
      var took = 0, gave = 0, collected = 0;
      UI.play.res.timeline.forEach(function (e) {
        if (e.t > UI.play.t) return;
        if (e.kind === 'arrive') took++;
        if (e.kind === 'deliver') { gave++; collected += e.amount || 0; }
      });
      cash = snap.cash + collected;
      debt = snap.debt; rep = snap.rep; custs = snap.customers;
      onSite = snap.onSite + took - gave;
      label = 'Day ' + UI.play.res.day + ' — ' + UI.play.res.cal.label + ' · in progress';
    } else if (s.phase === 'evening' && UI.lastResult) {
      label = 'Day ' + UI.lastResult.day + ' — ' + UI.lastResult.cal.label + ' · closing out';
    }

    var kpis = [
      { k: 'Cash', v: money(cash), c: cash < 5000 ? 'bad' : cash < 15000 ? 'warn' : 'good' },
      { k: 'Credit Line', v: money(debt) + ' / ' + money(D.FINANCE.creditLimit), c: debt > 40000 ? 'warn' : '' },
      { k: 'Rating', v: '<span class="stars">' + stars(rep) + '</span> ' + rep.toFixed(2), c: '' },
      { k: 'Customers', v: custs, c: '' },
      { k: 'Cars On Lot', v: onSite + ' / ' + s.parking, c: onSite >= s.parking ? 'bad' : onSite > s.parking * 0.8 ? 'warn' : '' },
      { k: 'Bays', v: s.bays.length, c: '' },
      { k: 'Crew', v: s.techs.length + ' tech · ' + s.advisors.length + ' adv', c: '' },
      { k: '30-Day Sales', v: money(s.stats.revenue30), c: '' },
      { k: 'ARO', v: money(s.stats.aro30), c: '' }
    ];
    return '' +
      '<div class="brand">' +
        '<h1>Torque <span>&amp;</span> Turnover</h1>' +
        '<div class="date">' + label + '</div>' +
        '<div class="spacer"></div>' +
        '<button class="btn sm ghost" data-act="save">Save</button>' +
        '<button class="btn sm ghost" data-act="load">Load</button>' +
        '<button class="btn sm ghost" data-act="newgame">New Game</button>' +
        '<button class="btn sm ghost" data-act="help">How To Play</button>' +
      '</div>' +
      '<div class="kpis">' + kpis.map(function (k) {
        return '<div class="kpi"><div class="k">' + k.k + '</div><div class="v ' + k.c + '">' + k.v + '</div></div>';
      }).join('') + '</div>' +
      (office ? '<nav class="tabs">' + [
        ['dash', 'Dashboard'], ['floor', 'Shop Floor'], ['crew', 'Crew & Training'],
        ['parts', 'Parts Room'], ['price', 'Pricing'], ['marketing', 'Marketing'],
        ['upgrades', 'Facility'], ['books', 'The Books']
      ].map(function (t) {
        return '<button data-act="tab" data-tab="' + t[0] + '" class="' +
          (office === t[0] ? 'active' : '') + '">' + t[1] + '</button>';
      }).join('') + '</nav>' : '');
  }

  /* The running log, shown in the rail on every screen. */
  function railLog(s) {
    return '<div class="panel"><h2>Log</h2><div class="log">' +
      s.log.slice(0, 40).map(function (l) {
        return '<div class="' + l.kind + '"><b>D' + l.day + '</b>' + esc(l.text) + '</div>';
      }).join('') + '</div></div>';
  }

  /* ---------------------------------------------------------------- *
   * Right rail: today's plan
   * ---------------------------------------------------------------- */
  /* ---------------------------------------------------------------- *
   * Tab: Dashboard
   * ---------------------------------------------------------------- */
  function tabDash() {
    var s = UI.state;
    var h = s.history;
    var last = h.slice(-45);
    var html = '';

    html += '<div class="panel"><h2>' + (UI.lastResult
      ? 'Day ' + UI.lastResult.day + ' — ' + UI.lastResult.cal.label
      : 'Yesterday') + '</h2>';
    if (!UI.lastResult) {
      html += '<p class="sub">You have not opened the doors yet. Set your prices, put some money ' +
        'behind advertising, make sure the parts you need are on the shelf, then open the shop.</p>';
    } else {
      var r = UI.lastResult;
      html += '<div class="grid g3">' +
        tile('Cars Delivered', r.cars, r.completed + ' jobs finished') +
        tile('Sales', money(r.revenue), money(r.laborRevenue) + ' labor · ' + money(r.partsRevenue) + ' parts') +
        tile('Net Profit', money(r.net), r.net >= 0 ? 'in the black' : 'in the red', r.net >= 0 ? 'good' : 'bad') +
        tile('Closing Ratio', r.presented ? pct(r.closed / r.presented) : '—', r.closed + ' of ' + r.presented + ' presented') +
        tile('Billed Hours', num(r.billedHours), 'from ' + num(r.actualHours) + ' clock hours') +
        tile('Bay Utilization', r.bayHoursAvail ? pct(r.bayHoursUsed / r.bayHoursAvail) : '—',
          num(r.bayHoursUsed) + ' of ' + num(r.bayHoursAvail) + ' bay hours') +
        '</div>';
    }
    html += '</div>';

    if (h.length > 1) {
      html += '<div class="panel"><h2>Trend</h2>' +
        '<div class="grid g2">' +
          '<div class="card"><h3>Daily sales &amp; net profit</h3>' +
            spark([
              { data: last.map(function (d) { return d.revenue; }), color: '#ff8c1a', fill: true },
              { data: last.map(function (d) { return d.net; }), color: '#4ec98a' }
            ]) +
            '<div class="legend"><span><i style="background:#ff8c1a"></i>Sales</span>' +
            '<span><i style="background:#4ec98a"></i>Net profit</span></div></div>' +
          '<div class="card"><h3>Cash &amp; reputation</h3>' +
            spark([{ data: last.map(function (d) { return d.cash; }), color: '#5aa9e6', fill: true }]) +
            '<div class="legend"><span><i style="background:#5aa9e6"></i>Cash on hand</span>' +
            '<span>Rating now ' + s.reputation.toFixed(2) + '</span></div></div>' +
        '</div></div>';
    }

    html += '<div class="panel"><h2>Where The Business Is Leaking</h2>' +
      '<p class="sub">Every one of these was a customer who wanted to give you money.</p>' +
      '<table><tr><th>Lost Opportunity</th><th class="num">Lifetime</th><th>What Fixes It</th></tr>' +
      leak('Calls nobody answered', s.stats.lostNoCapacity, 'Hire an advisor, or buy phone-skills training and shop management software.') +
      leak('No room on the lot', s.stats.lostNoParking, 'Pave more parking, or finish cars faster so they leave.') +
      leak('Work you cannot perform', s.stats.lostNoCapability, 'Add bays, tooling and certifications to widen your service menu.') +
      leak('Comebacks', s.stats.comebackCount, 'Better technicians, better tooling, better parts. Comebacks are free labor you already paid for.') +
      '</table></div>';

    html += '<div class="panel"><h2>Milestones</h2><div class="row wrap">' +
      D.MILESTONES.map(function (m) {
        var got = s.milestones[m.key];
        return '<span class="tag ' + (got ? 'ok' : '') + '">' + esc(m.name) + (got ? ' ✓ d' + got : '') + '</span>';
      }).join('') + '</div></div>';

    return html;
  }
  function tile(k, v, note, cls) {
    return '<div class="card"><div class="k" style="font-size:10px;letter-spacing:.8px;color:var(--dimmer);text-transform:uppercase">' +
      k + '</div><div class="money ' + (cls || '') + '" style="font-size:22px;font-weight:700">' + v + '</div>' +
      '<div class="note" style="margin:2px 0 0">' + note + '</div></div>';
  }
  function leak(name, n, fix) {
    return '<tr><td>' + name + '</td><td class="num">' + n + '</td><td class="muted small">' + fix + '</td></tr>';
  }

  /* ---------------------------------------------------------------- *
   * Tab: Shop Floor
   * ---------------------------------------------------------------- */
  function tabFloor() {
    var s = UI.state;
    var caps = E.capabilities(s);
    var html = '';

    html += '<div class="panel"><h2>Bays &amp; Tooling</h2>' +
      '<p class="sub">A bay can only perform the work its tooling supports. Tooling also makes ' +
      'every hour in that bay faster and cuts comebacks.</p><div class="grid g2">';

    s.bays.forEach(function (b) {
      var pkgs = D.TOOL_PACKAGES[b.type];
      var cur = pkgs[b.toolLevel - 1];
      var next = pkgs[b.toolLevel];
      var building = s.construction.filter(function (c) { return c.bayId === b.id; })[0];
      var status = b.readyDay > s.day ? '<span class="tag warn">Under construction — day ' + b.readyDay + '</span>'
        : b.downUntil > s.day ? '<span class="tag no">Red-tagged until day ' + b.downUntil + '</span>'
          : '<span class="tag ok">Open</span>';
      html += '<div class="card">' +
        '<div class="spread"><h3>' + esc(b.name) + '</h3>' + status + '</div>' +
        '<div class="note">' + esc(cur.name) + '</div>' +
        '<div class="row" style="margin:6px 0"><span class="small muted">Tool level</span>' +
          pips(b.toolLevel, pkgs.length) +
          '<span class="small muted">' + num(E.baySpeed(b), 2) + '× speed</span></div>' +
        '<div class="small muted">Utilization yesterday</div>' + bar(b.utilization,
          b.utilization > 0.9 ? 'bad' : b.utilization > 0.7 ? 'warn' : 'good') +
        '<div class="row wrap" style="margin-top:8px">' +
          Object.keys(E.bayTags(b)).map(function (t) { return '<span class="tag info">' + t + '</span>'; }).join('') +
        '</div>';
      if (building) {
        html += '<p class="small muted" style="margin:8px 0 0">' + esc(building.label) + ' arriving day ' + building.readyDay + '.</p>';
      } else if (next) {
        html += '<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:9px">' +
          '<div class="small"><b>Next: ' + esc(next.name) + '</b></div>' +
          '<div class="small muted">' + money(next.cost) + ' · ' + next.days + ' day install · ' +
          num(next.speed, 2) + '× speed' +
          (next.unlocks.length ? ' · unlocks ' + next.unlocks.join(', ') : '') + '</div>' +
          '<button class="btn sm" style="margin-top:7px" data-act="tools" data-id="' + b.id + '"' +
          (next.cost > s.cash ? ' disabled' : '') + '>Install for ' + money(next.cost) + '</button>' +
          '</div>';
      } else {
        html += '<p class="small muted" style="margin:8px 0 0">Fully tooled.</p>';
      }
      html += '</div>';
    });
    html += '</div></div>';

    html += '<div class="panel"><h2>Build A Bay</h2>' +
      '<p class="sub">More bays mean more cars in the air at once — but a bay with nobody to staff it ' +
      'earns nothing.</p><div class="grid g2">' +
      Object.keys(D.BAY_TYPES).map(function (k) {
        var t = D.BAY_TYPES[k];
        return '<div class="card"><div class="spread"><h3>' + esc(t.name) + '</h3>' +
          '<span class="money">' + money(t.buildCost) + '</span></div>' +
          '<div class="note">' + esc(t.note) + '</div>' +
          '<button class="btn sm" data-act="buildbay" data-type="' + k + '"' +
          (t.buildCost > s.cash ? ' disabled' : '') + '>Build (' + t.buildDays + ' days)</button></div>';
      }).join('') + '</div></div>';

    /* Work in progress board */
    html += '<div class="panel"><h2>On The Lot (' + s.openROs.length + ' / ' + s.parking + ' spaces)</h2>';
    if (!s.openROs.length) {
      html += '<p class="sub">Nothing in the shop. Every empty bay-hour is gone forever.</p>';
    } else {
      html += '<table><tr><th>RO</th><th>Customer</th><th>Work</th><th class="num">Hours Left</th><th>Status</th></tr>' +
        s.openROs.slice(0, 40).map(function (ro) {
          var left = ro.jobs.reduce(function (a, j) { return a + (j.done ? 0 : j.remaining); }, 0);
          var waiting = ro.jobs.some(function (j) { return j.waitingParts; });
          var age = s.day - ro.soldDay;
          return '<tr><td class="muted small">' + esc(ro.id) + '</td>' +
            '<td>' + esc(ro.customer) + '</td>' +
            '<td class="small">' + ro.jobs.map(function (j) {
              return (j.done ? '<span class="tag ok">' : '<span class="tag">') + esc(j.name) + '</span>';
            }).join('') + '</td>' +
            '<td class="num">' + num(left) + '</td>' +
            '<td>' + (waiting ? '<span class="tag no">Waiting on parts</span>'
              : age > 1 ? '<span class="tag warn">' + age + ' days in shop</span>'
                : '<span class="tag info">In progress</span>') + '</td></tr>';
        }).join('') + '</table>';
    }
    html += '</div>';

    html += '<div class="panel"><h2>Service Menu</h2>' +
      '<p class="sub">Work you cannot perform is work the town stops calling you about. Coverage drives ' +
      'how many opportunities reach your phone.</p>' +
      '<table><tr><th>Job</th><th class="num">Book Hrs</th><th class="num">Sells For</th><th>Needs</th><th>Status</th></tr>' +
      D.JOBS.map(function (j) {
        var c = caps[j.key];
        var labor = E.DIAG_BILLED[j.key]
          ? s.prices.diagFee + Math.max(0, j.bookHours - 1) * s.prices.laborRate
          : j.bookHours * s.prices.laborRate;
        var partsRetail = 0;
        for (var k in j.parts) {
          var u = E.unitCostFor(s, k);
          partsRetail += j.parts[k] * u * E.partsMarkupFor(s, u, k);
        }
        var needs = [];
        j.bays.forEach(function (b) { needs.push(D.BAY_TYPES[b].name.replace(' Bay', '')); });
        var need = needs.join(' or ');
        if (j.tags.length) need += ' + ' + j.tags.join('/');
        if (j.certs.length) need += ' + ' + j.certs.map(function (x) { return D.CERTS[x].name; }).join(', ');
        return '<tr' + (c.ok ? '' : ' class="dim"') + '><td>' + esc(j.name) + '</td>' +
          '<td class="num">' + num(j.bookHours) + '</td>' +
          '<td class="num">' + money(labor + partsRetail) + '</td>' +
          '<td class="small muted">' + esc(need) + '</td>' +
          '<td>' + (c.ok ? '<span class="tag ok">Available</span>'
            : !c.bay ? '<span class="tag no">No tooling</span>'
              : '<span class="tag warn">No certified tech</span>') + '</td></tr>';
      }).join('') + '</table></div>';

    return html;
  }

  /* ---------------------------------------------------------------- *
   * Tab: Crew
   * ---------------------------------------------------------------- */
  function tabCrew() {
    var s = UI.state;
    var html = '';

    /* --- technicians --- */
    html += '<div class="panel"><h2>Technicians</h2>' +
      '<p class="sub">Technicians are paid flat rate: they earn the hours they bill, with a ' +
      D.FINANCE.techGuaranteeHours + '-hour daily guarantee. A skilled tech beats book time; a green one ' +
      'burns your bay.</p><div class="grid g2">';

    s.techs.forEach(function (t) {
      var eff = t.lifetimeActual ? t.lifetimeBilled / t.lifetimeActual : t.efficiency;
      var busy = t.trainingUntil > s.day;
      html += '<div class="card">' +
        '<div class="spread"><h3>' + esc(t.name) + '</h3>' +
          '<span class="money small">$' + t.flatRate + '/hr flat</span></div>' +
        (busy ? '<div class="tag warn">In class: ' + esc(t.trainingName) + ' (back day ' + t.trainingUntil + ')</div>' : '') +
        '<table style="margin:8px 0">' + D.SKILL_AREAS.map(function (a) {
          return '<tr><td class="small">' + a.name + '</td><td style="width:90px">' + pips(t.skills[a.key], 5) + '</td></tr>';
        }).join('') + '</table>' +
        '<div class="row wrap">' + (t.certs.length
          ? t.certs.map(function (c) { return '<span class="tag info">' + esc(D.CERTS[c].name) + '</span>'; }).join('')
          : '<span class="small muted">No certifications</span>') + '</div>' +
        '<div class="grid g2" style="margin-top:9px;gap:6px">' +
          '<div><div class="small muted">Productivity</div><div class="money">' + pct(eff) + '</div></div>' +
          '<div><div class="small muted">Quality</div><div class="money">' + pct(t.quality) + '</div></div>' +
          '<div><div class="small muted">Morale</div>' + bar(t.morale, t.morale < 0.4 ? 'bad' : t.morale < 0.65 ? 'warn' : 'good') + '</div>' +
          '<div><div class="small muted">Fatigue</div>' + bar(t.fatigue, t.fatigue > 0.6 ? 'bad' : t.fatigue > 0.3 ? 'warn' : '') + '</div>' +
        '</div>' +
        '<label class="field" style="margin-top:9px"><span class="lab">Scheduled hours today <b>' +
          t.scheduledHours + 'h</b></span>' +
          '<input type="range" min="0" max="' + E.shiftHours(s) + '" step="1" value="' + t.scheduledHours +
          '" data-act="schedule" data-id="' + t.id + '"></label>' +
        '<div class="row"><select data-role="course" data-id="' + t.id + '" style="flex:1">' +
          D.TECH_TRAINING.map(function (c) {
            var have = c.cert && t.certs.indexOf(c.cert) >= 0;
            var maxed = c.skill && !c.cert && t.skills[c.skill] >= 5;
            return '<option value="' + c.key + '"' + (have || maxed ? ' disabled' : '') + '>' +
              esc(c.name) + ' — ' + money(c.cost) + ', ' + c.days + 'd' +
              (have ? ' (certified)' : maxed ? ' (maxed)' : '') + '</option>';
          }).join('') + '</select>' +
          '<button class="btn sm" data-act="train" data-id="' + t.id + '"' + (busy ? ' disabled' : '') + '>Enroll</button>' +
        '</div>' +
        '<div class="right" style="margin-top:7px">' +
          '<button class="btn sm danger ghost" data-act="fire" data-id="' + t.id + '">Let go</button></div>' +
        '</div>';
    });
    if (!s.techs.length) html += '<p class="muted">No technicians. Nothing gets fixed.</p>';
    html += '</div></div>';

    /* --- advisors --- */
    html += '<div class="panel"><h2>Service Advisors</h2>' +
      '<p class="sub">Advisors decide how many callers get helped, how much of what you find gets sold, ' +
      'and whether the customer comes back. Training compounds: it applies to every car, every day.</p>' +
      '<div class="grid g2">';

    s.advisors.forEach(function (a) {
      var busy = a.trainingUntil > s.day;
      html += '<div class="card">' +
        '<div class="spread"><h3>' + esc(a.name) + '</h3>' +
          '<span class="money small">' + (a.salary ? money(a.salary) + '/day' : 'owner') + '</span></div>' +
        '<div class="note">Natural ability ' + a.experience + '/5 · ' +
          D.FINANCE.advisorCommissionOnGP * 100 + '% commission on gross profit</div>' +
        (busy ? '<div class="tag warn">In training: ' + esc(a.trainingName) + '</div>' : '') +
        '<table style="margin-top:8px">' + D.ADVISOR_TRACKS.map(function (tr) {
          var lvl = a.tracks[tr.key] || 0;
          var cost = E.advisorTrainingCost(tr, lvl);
          return '<tr><td><div class="small">' + esc(tr.name) + '</div>' +
            '<div class="small muted">' + esc(tr.note) + '</div></td>' +
            '<td style="width:80px">' + pips(lvl, tr.max) + '</td>' +
            '<td class="num" style="width:110px">' + (lvl >= tr.max
              ? '<span class="tag ok">Max</span>'
              : '<button class="btn sm" data-act="advtrain" data-id="' + a.id + '" data-track="' + tr.key + '"' +
                (busy || cost > s.cash ? ' disabled' : '') + '>' + money(cost) + '</button>') +
            '</td></tr>';
        }).join('') + '</table>' +
        (s.advisors.length > 1 ? '<div class="right" style="margin-top:7px">' +
          '<button class="btn sm danger ghost" data-act="fire" data-id="' + a.id + '">Let go</button></div>' : '') +
        '</div>';
    });
    html += '</div>' +
      '<div class="card" style="margin-top:12px"><div class="spread">' +
      '<div><b>Front counter capacity:</b> <span class="money">' + num(E.advisorCapacity(s), 0) +
      ' customers/day</span></div>' +
      '<div class="small muted">Estimated closing ratio ' + pct(E.estimateCloseRate(s, 1)) + '</div>' +
      '</div></div></div>';

    /* --- hiring --- */
    html += '<div class="panel"><h2>Hiring</h2>' +
      '<div class="spread"><p class="sub" style="margin:0">Candidates refresh when you run a recruiting ad. ' +
      'Good techs are expensive and worth it; green techs are cheap and slow.</p>' +
      '<button class="btn sm" data-act="refreshpool">Run recruiting ad ($600)</button></div>' +
      '<div class="grid g3" style="margin-top:12px">';

    s.hiringPool.techs.forEach(function (t) {
      var top = D.SKILL_AREAS.slice().sort(function (a, b) { return t.skills[b.key] - t.skills[a.key]; }).slice(0, 3);
      html += '<div class="card"><div class="spread"><h3>' + esc(t.name) + '</h3>' +
        '<span class="tag">Tech</span></div>' +
        '<div class="note">$' + t.flatRate + '/flat hour' +
        (t.signingBonus ? ' · ' + money(t.signingBonus) + ' signing bonus' : '') + '</div>' +
        '<table>' + top.map(function (a) {
          return '<tr><td class="small">' + a.name + '</td><td style="width:80px">' + pips(t.skills[a.key], 5) + '</td></tr>';
        }).join('') + '</table>' +
        '<div class="small muted">Productivity ' + pct(t.efficiency) + ' · quality ' + pct(t.quality) + '</div>' +
        (t.certs.length ? '<div class="row wrap" style="margin-top:5px">' + t.certs.map(function (c) {
          return '<span class="tag info">' + esc(D.CERTS[c].name) + '</span>';
        }).join('') + '</div>' : '') +
        '<button class="btn sm" style="margin-top:8px" data-act="hire" data-id="' + t.id + '">Hire</button></div>';
    });
    s.hiringPool.advisors.forEach(function (a) {
      html += '<div class="card"><div class="spread"><h3>' + esc(a.name) + '</h3>' +
        '<span class="tag info">Advisor</span></div>' +
        '<div class="note">' + money(a.salary) + '/day' +
        (a.signingBonus ? ' · ' + money(a.signingBonus) + ' signing bonus' : '') + '</div>' +
        '<div class="small">Natural ability ' + pips(a.experience, 5) + '</div>' +
        '<div class="row wrap" style="margin-top:6px">' + D.ADVISOR_TRACKS.filter(function (tr) {
          return a.tracks[tr.key];
        }).map(function (tr) { return '<span class="tag ok">' + esc(tr.name) + '</span>'; }).join('') + '</div>' +
        '<button class="btn sm" style="margin-top:8px" data-act="hire" data-id="' + a.id + '">Hire</button></div>';
    });
    html += '</div></div>';

    return html;
  }

  /* ---------------------------------------------------------------- *
   * Tab: Parts
   * ---------------------------------------------------------------- */
  function tabParts() {
    var s = UI.state;
    var sug = E.suggestOrder(s, 7);
    var used = E.storageUsed(s);
    var prog = D.ORDER_PROGRAMS[s.orderProgram];
    var sup = D.SUPPLIERS[s.supplier];

    var html = '<div class="panel"><h2>Buying Program</h2>' +
      '<div class="grid g2">' +
        '<label class="field"><span class="lab">Parts quality tier</span>' +
          '<select data-act="supplier">' + Object.keys(D.SUPPLIERS).map(function (k) {
            var x = D.SUPPLIERS[k];
            return '<option value="' + k + '"' + (k === s.supplier ? ' selected' : '') + '>' +
              esc(x.name) + ' (' + num(x.costMult, 2) + '× cost)</option>';
          }).join('') + '</select>' +
          '<span class="small muted">' + esc(sup.note) + '</span></label>' +
        '<label class="field"><span class="lab">Ordering program</span>' +
          '<select data-act="program">' + Object.keys(D.ORDER_PROGRAMS).map(function (k) {
            var x = D.ORDER_PROGRAMS[k];
            return '<option value="' + k + '"' + (k === s.orderProgram ? ' selected' : '') + '>' +
              esc(x.name) + ' (' + num(x.costMult, 2) + '× cost)</option>';
          }).join('') + '</select>' +
          '<span class="small muted">' + esc(prog.note) + '</span></label>' +
      '</div>' +
      '<label class="field"><span class="lab">Emergency hot-shot when a part is missing mid-job <b>' +
        (s.autoHotshot ? 'ON' : 'OFF') + '</b></span>' +
        '<button class="btn sm" data-act="hotshot">' + (s.autoHotshot ? 'Turn off' : 'Turn on') + '</button>' +
        '<span class="small muted"> Pays ' + num((D.HOTSHOT_MULT - 1) * 100, 0) +
        '% over cost to keep the car moving. With it off, the car sits and the customer stews.</span></label>' +
      '<div class="spread" style="margin-top:6px"><span class="small muted">Parts room storage</span>' +
        '<span class="money small">' + num(used, 0) + ' / ' + s.storage + ' units</span></div>' +
        bar(used / s.storage, used / s.storage > 0.9 ? 'bad' : '') +
      '</div>';

    html += '<div class="panel"><h2>Inventory &amp; Ordering</h2>' +
      '<p class="sub">The suggested column covers seven days of expected demand at your current close ' +
      'rate, with a cushion for upsells.</p>' +
      '<table><tr><th>Category</th><th class="num">On Hand</th><th class="num">Inbound</th>' +
      '<th class="num">7-Day Need</th><th class="num">Unit Cost</th><th class="num">Retail</th>' +
      '<th class="num">Order</th><th></th></tr>' +
      sug.map(function (row) {
        var cat = D.partByKey[row.cat];
        var unit = E.unitCostFor(s, row.cat) * prog.costMult;
        var retail = E.unitCostFor(s, row.cat) * E.partsMarkupFor(s, E.unitCostFor(s, row.cat), row.cat);
        var low = row.have + row.coming < row.want * 0.5;
        return '<tr><td><div>' + esc(cat.name) + '</div>' +
          '<div class="small muted">' + esc(cat.note) + '</div></td>' +
          '<td class="num ' + (low ? 'neg' : '') + '">' + row.have + '</td>' +
          '<td class="num muted">' + (row.coming || '—') + '</td>' +
          '<td class="num">' + row.want + '</td>' +
          '<td class="num">' + money2(unit) + '</td>' +
          '<td class="num muted">' + money2(retail) + '</td>' +
          '<td class="num"><input type="number" min="0" step="1" value="' + row.order +
            '" data-role="qty" data-cat="' + row.cat + '" style="width:80px"></td>' +
          '<td><button class="btn sm" data-act="order" data-cat="' + row.cat + '">Order</button></td></tr>';
      }).join('') +
      '</table>' +
      '<div class="row" style="margin-top:10px">' +
        '<button class="btn primary" data-act="orderall">Order everything suggested</button>' +
        '<span class="small muted">Estimated ' + money(sug.reduce(function (a, r) {
          return a + r.order * E.unitCostFor(s, r.cat) * prog.costMult;
        }, 0)) + '</span>' +
      '</div></div>';

    if (s.onOrder.length) {
      html += '<div class="panel"><h2>On Order</h2><table>' +
        '<tr><th>Category</th><th class="num">Units</th><th class="num">Cost</th><th class="num">Arrives</th></tr>' +
        s.onOrder.map(function (o) {
          return '<tr><td>' + esc(D.partByKey[o.cat].name) + '</td><td class="num">' + o.units + '</td>' +
            '<td class="num">' + money(o.cost) + '</td><td class="num">Day ' + o.arriveDay +
            ' (' + Math.max(0, o.arriveDay - s.day) + 'd)</td></tr>';
        }).join('') + '</table></div>';
    }

    return html;
  }

  /* ---------------------------------------------------------------- *
   * Tab: Pricing
   * ---------------------------------------------------------------- */
  function tabPrice() {
    var s = UI.state;
    var pi = E.priceIndex(s), tol = E.priceTolerance(s);
    var over = pi - tol;
    var verdict = over > 0.12 ? ['bad', 'You are well above what this town will bear. Expect walkouts.']
      : over > 0.03 ? ['warn', 'A little rich. You are losing some price shoppers.']
        : over > -0.06 ? ['good', 'Priced right in the pocket.']
          : ['', 'You are leaving money on the table. Every point of rate is almost pure profit.'];

    var html = '<div class="panel"><h2>Pricing</h2>' +
      '<p class="sub">The market charges ' + money(D.TOWN.marketLaborRate) + '/hour, marks parts up ' +
      num(D.TOWN.marketPartsMarkup, 2) + '×, and gets ' + money(D.TOWN.marketDiagFee) +
      ' for a diagnosis. Objection-handling training and a financing program raise what customers ' +
      'will accept before they walk.</p>' +
      '<div class="grid g2">' +
        slider('Door rate ($/billed hour)', 'laborRate', s.prices.laborRate, 90, 260, 5, money(s.prices.laborRate) + '/hr') +
        slider('Parts markup (matrix base)', 'partsMarkup', s.prices.partsMarkup, 1.2, 2.8, 0.05, num(s.prices.partsMarkup, 2) + '×') +
        slider('Diagnostic fee', 'diagFee', s.prices.diagFee, 0, 320, 5, money(s.prices.diagFee)) +
        slider('Coupon / discount', 'coupon', s.prices.coupon, 0, 40, 1, s.prices.coupon + '% off') +
      '</div>' +
      '<div class="alert ' + verdict[0] + '" style="margin-top:8px">' +
        '<b>Price index ' + num(pi, 2) + '</b> against a customer tolerance of ' + num(tol, 2) + '. ' + verdict[1] +
      '</div>' +
      '<details class="help"><summary>How pricing actually moves the needle</summary>' +
      '<p>Your price index blends door rate (58%), parts markup (32%) and diagnostic fee (10%) against ' +
      'the market. Every point above tolerance costs you closing ratio and satisfaction; every point ' +
      'below is margin you gave away. A discount coupon buys closing ratio and costs you gross profit ' +
      'on every car — including the ones that would have bought anyway.</p></details>' +
      '</div>';

    /* Margin math */
    var laborGP = 1;
    if (s.techs.length) {
      var avgRate = s.techs.reduce(function (a, t) { return a + t.flatRate; }, 0) / s.techs.length;
      laborGP = 1 - (avgRate * (1 + D.FINANCE.payrollTaxRate)) / s.prices.laborRate;
    }
    html += '<div class="panel"><h2>Margin Check</h2><div class="grid g3">' +
      tile('Labor gross profit', pct(laborGP), 'after flat-rate pay and payroll burden',
        laborGP > 0.6 ? 'good' : laborGP > 0.45 ? '' : 'bad') +
      tile('Effective labor rate', money(s.stats.aro30 && s.history.length
        ? s.history.slice(-30).reduce(function (a, h) { return a + h.revenue; }, 0) /
          Math.max(1, s.history.slice(-30).reduce(function (a, h) { return a + h.billed; }, 0))
        : s.prices.laborRate), 'total sales per billed hour') +
      tile('Break-even sales/day', money(dailyBreakEven(s)), 'fixed costs, payroll guarantee and ads') +
      '</div>' +
      '<table style="margin-top:12px"><tr><th>Example ticket</th><th class="num">Labor</th>' +
      '<th class="num">Parts</th><th class="num">Total</th><th class="num">Gross Profit</th></tr>' +
      ['oil', 'brakes', 'diag', 'tires4', 'timing'].map(function (k) {
        var j = D.jobByKey[k];
        var labor = E.DIAG_BILLED[k] ? s.prices.diagFee + Math.max(0, j.bookHours - 1) * s.prices.laborRate
          : j.bookHours * s.prices.laborRate;
        labor *= (1 - s.prices.coupon / 100);
        var pc = 0, pr = 0;
        for (var c in j.parts) {
          var u = E.unitCostFor(s, c);
          pc += j.parts[c] * u;
          pr += j.parts[c] * u * E.partsMarkupFor(s, u, c);
        }
        pr *= (1 - s.prices.coupon / 100 * 0.4);
        var techCost = j.bookHours * (s.techs.length ? s.techs[0].flatRate : 30) * (1 + D.FINANCE.payrollTaxRate);
        var gp = labor + pr - pc - techCost;
        return '<tr><td>' + esc(j.name) + '</td><td class="num">' + money(labor) + '</td>' +
          '<td class="num">' + money(pr) + '</td><td class="num">' + money(labor + pr) + '</td>' +
          '<td class="num ' + (gp > 0 ? 'pos' : 'neg') + '">' + money(gp) + '</td></tr>';
      }).join('') + '</table></div>';

    return html;
  }

  function dailyBreakEven(s) {
    var fixed = E.dailyFixedCost(s);
    var guarantee = s.techs.reduce(function (a, t) {
      return a + D.FINANCE.techGuaranteeHours * t.flatRate;
    }, 0) * (1 + D.FINANCE.payrollTaxRate);
    var adv = s.advisors.reduce(function (a, x) { return a + x.salary; }, 0) * (1 + D.FINANCE.payrollTaxRate);
    var ads = Object.keys(s.adSpend).reduce(function (a, k) { return a + s.adSpend[k]; }, 0);
    var gpRate = 0.55;
    return (fixed + guarantee + adv + ads) / gpRate;
  }

  function slider(label, key, val, min, max, step, display) {
    return '<label class="field"><span class="lab">' + label + ' <b>' + display + '</b></span>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val +
      '" data-act="price" data-key="' + key + '">' +
      '<input type="number" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val +
      '" data-act="price" data-key="' + key + '" style="margin-top:5px"></label>';
  }

  /* ---------------------------------------------------------------- *
   * Tab: Marketing
   * ---------------------------------------------------------------- */
  function tabMarketing() {
    var s = UI.state;
    var f = E.forecast(s);
    var total = Object.keys(s.adSpend).reduce(function (a, k) { return a + s.adSpend[k]; }, 0);
    // Quote each channel on a normal trading day rather than today's day-of-week
    // swing, so the numbers are something you can actually budget against.
    var leadsByKey = {};
    D.AD_CHANNELS.forEach(function (c) {
      leadsByKey[c.key] = E.channelLeads(s, c) * f.coverageMult;
    });

    var html = '<div class="panel"><h2>Advertising</h2>' +
      '<p class="sub">Every channel saturates: doubling spend never doubles calls. Fast channels ' +
      '(search) turn on and off with the money. Slow channels (SEO, radio, community) take weeks to ' +
      'build and keep paying after you stop. Awareness carries over day to day.</p>' +
      '<div class="grid g2">';

    D.AD_CHANNELS.forEach(function (c) {
      var spend = s.adSpend[c.key] || 0;
      var leads = leadsByKey[c.key] || 0;
      var stock = s.adStock[c.key] || 0;
      var cpl = leads > 0.05 ? spend / leads : 0;
      var estValue = leads * E.estimateCloseRate(s, c.intent) * (s.stats.aro30 || 480) * c.aro * 0.55;
      html += '<div class="card">' +
        '<div class="spread"><h3>' + esc(c.name) + '</h3>' +
          '<span class="tag ' + (c.lag > 2 ? 'warn' : 'info') + '">' +
          (c.lag ? c.lag + '-day lag' : 'same day') + '</span></div>' +
        '<div class="note">' + esc(c.note) + '</div>' +
        '<label class="field"><span class="lab">Daily budget <b>' + money(spend) + '</b></span>' +
          '<input type="range" min="0" max="' + Math.round(c.halfSpend * 4) + '" step="5" value="' + spend +
          '" data-act="ad" data-key="' + c.key + '"></label>' +
        '<div class="small muted">Awareness built</div>' + bar(stock / (c.halfSpend * 2.5)) +
        '<table style="margin-top:7px">' +
          '<tr><td class="small">Expected calls per normal day</td><td class="num">' + num(leads, 1) + '</td></tr>' +
          '<tr><td class="small">Cost per call</td><td class="num">' + (cpl ? money2(cpl) : '—') + '</td></tr>' +
          '<tr><td class="small">Lead quality</td><td class="num">' + num(c.intent, 2) + '× close</td></tr>' +
          '<tr><td class="small">Est. gross profit produced</td><td class="num ' +
            (estValue > spend ? 'pos' : 'neg') + '">' + money(estValue) + '</td></tr>' +
        '</table>' +
        (spend > 0 && spend < c.minSpend
          ? '<div class="alert bad small" style="margin-top:6px">Below the ' + money(c.minSpend) +
            ' minimum — this budget buys nothing.</div>' : '') +
        '</div>';
    });
    html += '</div>' +
      '<div class="card" style="margin-top:12px"><div class="spread">' +
        '<div><b>Total daily ad spend:</b> <span class="money">' + money(total) + '</span> ' +
        '<span class="muted small">(' + money(total * 30) + '/month)</span></div>' +
        '<div class="small muted">Paid calls on a normal day: ' + num(D.AD_CHANNELS.reduce(function (a, c) {
          return a + E.channelLeads(s, c) * f.coverageMult;
        }, 0), 1) + '</div>' +
      '</div></div>' +
      '<details class="help"><summary>Why the same dollar performs differently by channel</summary>' +
      '<p>Each channel produces leads on a saturation curve — the first $50 buys far more than the ' +
      'fifth $50. Lead quality multiplies your closing ratio, so a search lead that closes at 1.18× is ' +
      'worth more than two mail leads at 0.78×. Slow channels build an awareness stock that decays a ' +
      'few percent per day, which is why they keep producing after you pause them, and why they take ' +
      'a month to prove anything.</p></details>' +
      '</div>';

    html += '<div class="panel"><h2>Reputation</h2>' +
      '<p class="sub">Reputation is the cheapest advertising there is: it multiplies every other ' +
      'channel and drives repeat business.</p>' +
      '<div class="grid g3">' +
        tile('Rating', s.reputation.toFixed(2) + ' <span class="stars">' + stars(s.reputation) + '</span>',
          s.reviewCount + ' reviews') +
        tile('Demand multiplier', num(f.repMult, 2) + '×', 'applied to every source of traffic') +
        tile('Loyal customers', s.customerBase, 'roughly ' + num(f.loyal, 1) + ' of them call on a day like today') +
      '</div></div>';

    return html;
  }

  /* ---------------------------------------------------------------- *
   * Tab: Facility upgrades
   * ---------------------------------------------------------------- */
  function tabUpgrades() {
    var s = UI.state;
    var html = '<div class="panel"><h2>Facility &amp; Systems</h2>' +
      '<p class="sub">These are the quiet multipliers. None of them turn a wrench; all of them change ' +
      'how much money the same crew produces.</p><div class="grid g2">' +
      D.UPGRADES.map(function (u) {
        var owned = s.upgrades[u.key] || 0;
        var building = s.construction.some(function (c) { return c.kind === 'upgrade' && c.key === u.key; });
        var can = (u.repeatable || !owned) && !building && u.cost <= s.cash;
        var effects = Object.keys(u.effect).map(function (k) {
          var v = u.effect[k];
          var label = {
            parking: 'parking spaces', storage: 'storage units', csi: 'satisfaction',
            close: 'closing ratio', upsell: 'upsell rate', advisorCapacity: 'customers/day per advisor',
            waitTolerance: 'days of patience', organic: 'walk-ins/day', aro: 'repair order size',
            priceTolerance: 'price tolerance', throughputStart: 'bay hours/day', shiftHours: 'hours in the day'
          }[k] || k;
          var shown = (k === 'csi' || k === 'parking' || k === 'storage' || k === 'advisorCapacity' ||
            k === 'organic' || k === 'waitTolerance' || k === 'throughputStart' || k === 'shiftHours')
            ? '+' + v : '+' + pct(v);
          return '<span class="tag ok">' + shown + ' ' + label + '</span>';
        }).join('');
        return '<div class="card"><div class="spread"><h3>' + esc(u.name) + '</h3>' +
          '<span class="money">' + money(u.cost) + '</span></div>' +
          '<div class="note">' + esc(u.note) + '</div>' +
          '<div class="row wrap">' + effects + '</div>' +
          '<div class="spread" style="margin-top:9px">' +
            '<span class="small muted">' + u.days + ' day install' +
            (u.upkeep ? ' · ' + money(u.upkeep) + '/day upkeep' : '') +
            (owned ? ' · owned ×' + owned : '') + '</span>' +
            (building ? '<span class="tag warn">In progress</span>'
              : '<button class="btn sm" data-act="upgrade" data-key="' + u.key + '"' +
                (can ? '' : ' disabled') + '>' + (owned && !u.repeatable ? 'Installed' : 'Buy') + '</button>') +
          '</div></div>';
      }).join('') + '</div></div>';

    html += '<div class="panel"><h2>Financing</h2>' +
      '<p class="sub">A ' + money(D.FINANCE.creditLimit) + ' line of credit at ' +
      pct(D.FINANCE.apr, 1) + ' APR. Cash shortfalls draw on it automatically; surplus cash above ' +
      '$12,000 sweeps against it.</p>' +
      '<div class="grid g2">' +
        '<div class="card"><h3>Draw</h3>' +
          '<div class="note">Available: ' + money(D.FINANCE.creditLimit - s.debt) + '</div>' +
          '<input type="number" min="0" step="1000" value="10000" data-role="borrow">' +
          '<button class="btn sm" style="margin-top:7px" data-act="borrow">Draw funds</button></div>' +
        '<div class="card"><h3>Repay</h3>' +
          '<div class="note">Balance: ' + money(s.debt) + ' · interest ' +
            money(s.debt * D.FINANCE.apr / 365) + '/day</div>' +
          '<input type="number" min="0" step="1000" value="' + Math.min(s.debt, Math.max(0, s.cash - 5000)) +
            '" data-role="repay">' +
          '<button class="btn sm" style="margin-top:7px" data-act="repay">Pay down</button></div>' +
      '</div></div>';

    return html;
  }

  /* ---------------------------------------------------------------- *
   * Tab: Books
   * ---------------------------------------------------------------- */
  function tabBooks() {
    var s = UI.state;
    var h = s.history;
    var last30 = h.slice(-30);
    var sum = function (k) { return last30.reduce(function (a, x) { return a + (x[k] || 0); }, 0); };
    var rev = sum('revenue'), net = sum('net'), cars = sum('cars'), billed = sum('billed');

    var html = '<div class="panel"><h2>Trailing 30 Days</h2><div class="grid g3">' +
      tile('Sales', money(rev), num(last30.length, 0) + ' days recorded') +
      tile('Net profit', money(net), rev ? pct(net / rev) + ' net margin' : '—', net >= 0 ? 'good' : 'bad') +
      tile('Cars', cars, cars ? money(rev / cars) + ' average repair order' : '—') +
      tile('Billed hours', num(billed, 0), cars ? num(billed / cars, 2) + ' hours per car' : '—') +
      tile('Technician productivity', pct(s.stats.techEfficiency), 'billed hours ÷ clock hours',
        s.stats.techEfficiency >= 1 ? 'good' : s.stats.techEfficiency > 0.85 ? '' : 'bad') +
      tile('Bay utilization', pct(s.stats.bayUtilization), 'across every open bay',
        s.stats.bayUtilization > 0.85 ? 'warn' : '') +
      '</div></div>';

    if (UI.lastResult) {
      var r = UI.lastResult;
      html += '<div class="panel"><h2>Yesterday&rsquo;s P&amp;L</h2>' + plTable(r) + '</div>';
    }

    if (h.length > 2) {
      var byWeek = [];
      for (var i = 0; i < h.length; i += 7) {
        var wk = h.slice(i, i + 7);
        byWeek.push({
          week: Math.floor(i / 7) + 1,
          revenue: wk.reduce(function (a, x) { return a + x.revenue; }, 0),
          net: wk.reduce(function (a, x) { return a + x.net; }, 0),
          cars: wk.reduce(function (a, x) { return a + x.cars; }, 0),
          ads: wk.reduce(function (a, x) { return a + x.adSpend; }, 0)
        });
      }
      html += '<div class="panel"><h2>By Week</h2><table>' +
        '<tr><th>Week</th><th class="num">Sales</th><th class="num">Net</th><th class="num">Cars</th>' +
        '<th class="num">ARO</th><th class="num">Ad Spend</th><th class="num">Ad % of Sales</th></tr>' +
        byWeek.slice(-16).reverse().map(function (w) {
          return '<tr><td>' + w.week + '</td><td class="num">' + money(w.revenue) + '</td>' +
            '<td class="num ' + (w.net >= 0 ? 'pos' : 'neg') + '">' + money(w.net) + '</td>' +
            '<td class="num">' + w.cars + '</td>' +
            '<td class="num">' + (w.cars ? money(w.revenue / w.cars) : '—') + '</td>' +
            '<td class="num">' + money(w.ads) + '</td>' +
            '<td class="num">' + (w.revenue ? pct(w.ads / w.revenue) : '—') + '</td></tr>';
        }).join('') + '</table></div>';
    }

    html += '<div class="panel"><h2>Fixed Overhead</h2><table>' +
      Object.keys(s.fixedCosts).map(function (k) {
        return '<tr><td style="text-transform:capitalize">' + k + '</td><td class="num">' +
          money(s.fixedCosts[k]) + '/mo</td><td class="num muted">' + money(s.fixedCosts[k] / 30) + '/day</td></tr>';
      }).join('') +
      '<tr class="total"><td><b>Total</b></td><td class="num"><b>' +
        money(Object.keys(s.fixedCosts).reduce(function (a, k) { return a + s.fixedCosts[k]; }, 0)) +
        '/mo</b></td><td class="num"><b>' + money(E.dailyFixedCost(s)) + '/day</b></td></tr>' +
      '</table><p class="small muted">Daily figure includes upkeep on loaners, shuttle, software and tablets.</p></div>';

    return html;
  }

  function plTable(r) {
    return '<table class="pl">' +
      '<tr><td>Labor sales</td><td>' + money(r.laborRevenue) + '</td></tr>' +
      '<tr><td>Parts sales</td><td>' + money(r.partsRevenue) + '</td></tr>' +
      '<tr class="total"><td>Total sales</td><td>' + money(r.revenue) + '</td></tr>' +
      '<tr><td class="muted">Cost of parts</td><td class="neg">-' + money(r.partsCost) + '</td></tr>' +
      (r.hotshotCost ? '<tr><td class="muted">Hot-shot part premiums (' + r.hotshotCount +
        ')</td><td class="neg">-' + money(r.hotshotCost) + '</td></tr>' : '') +
      '<tr><td class="muted">Technician pay</td><td class="neg">-' + money(r.techPay || 0) + '</td></tr>' +
      '<tr class="total"><td>Gross profit</td><td>' + money(r.revenue - r.partsCost - (r.techPay || 0)) + '</td></tr>' +
      '<tr><td class="muted">Advisor pay &amp; commission</td><td class="neg">-' + money(r.advisorPay || 0) + '</td></tr>' +
      '<tr><td class="muted">Advertising</td><td class="neg">-' + money(r.adSpend) + '</td></tr>' +
      '<tr><td class="muted">Fixed overhead</td><td class="neg">-' + money(r.fixed) + '</td></tr>' +
      '<tr><td class="muted">Warranty reserve</td><td class="neg">-' + money(r.warranty || 0) + '</td></tr>' +
      (r.interest > 0.5 ? '<tr><td class="muted">Interest</td><td class="neg">-' + money(r.interest) + '</td></tr>' : '') +
      (r.taxes ? '<tr><td class="muted">Estimated taxes</td><td class="neg">-' + money(r.taxes) + '</td></tr>' : '') +
      '<tr class="total"><td>Net profit</td><td class="' + (r.net >= 0 ? 'pos' : 'neg') + '">' +
        money(r.net) + '</td></tr>' +
      '</table>';
  }

  /* ---------------------------------------------------------------- *
   * Day report modal
   * ---------------------------------------------------------------- */
  function dayReport(r) {
    var s = UI.state;
    var body = '';
    if (r.closed) {
      body = '<p>Closed for the day. Overhead of ' + money(r.fixed) + ' ran anyway, and ' +
        money(r.adSpend) + ' of advertising kept running.</p>';
    } else {
      body += '<div class="grid g3" style="margin-bottom:14px">' +
        tile('Cars delivered', r.cars, r.carryover + ' still in the shop') +
        tile('Sales', money(r.revenue), r.cars ? money(r.revenue / r.cars) + ' per car' : '—') +
        tile('Net profit', money(r.net), '', r.net >= 0 ? 'good' : 'bad') +
        '</div>';

      body += '<div class="grid g2"><div>' + plTable(r) + '</div><div>' +
        '<table><tr><th>Front counter</th><th class="num"></th></tr>' +
        '<tr><td>Opportunities</td><td class="num">' + r.opportunities + '</td></tr>' +
        '<tr><td>Handled by advisors</td><td class="num">' + r.presented + '</td></tr>' +
        '<tr><td>Sold</td><td class="num">' + r.closed + ' (' +
          (r.presented ? pct(r.closed / r.presented) : '—') + ')</td></tr>' +
        (r.turnedAwayCapacity ? '<tr><td class="neg">Calls missed</td><td class="num neg">' +
          r.turnedAwayCapacity + '</td></tr>' : '') +
        (r.turnedAwayParking ? '<tr><td class="neg">Turned away — lot full</td><td class="num neg">' +
          r.turnedAwayParking + '</td></tr>' : '') +
        (r.lostCapability ? '<tr><td class="neg">Work you cannot do</td><td class="num neg">' +
          r.lostCapability + '</td></tr>' : '') +
        '<tr><td>Billed hours</td><td class="num">' + num(r.billedHours) + '</td></tr>' +
        '<tr><td>Clock hours</td><td class="num">' + num(r.actualHours) + '</td></tr>' +
        '<tr><td>Productivity</td><td class="num">' + (r.actualHours ? pct(r.billedHours / r.actualHours) : '—') + '</td></tr>' +
        '<tr><td>Bay utilization</td><td class="num">' +
          (r.bayHoursAvail ? pct(r.bayHoursUsed / r.bayHoursAvail) : '—') + '</td></tr>' +
        (r.comebacks ? '<tr><td class="neg">Comebacks</td><td class="num neg">' + r.comebacks + '</td></tr>' : '') +
        '<tr><td>Average satisfaction</td><td class="num">' + (r.avgSat || '—') + '</td></tr>' +
        '</table></div></div>';

      var jobs = Object.keys(r.jobsDone);
      if (jobs.length) {
        body += '<h3 style="margin:16px 0 6px;font-size:13px">Work completed</h3><div class="row wrap">' +
          jobs.map(function (k) {
            return '<span class="tag">' + esc(D.jobByKey[k].name) + ' ×' + r.jobsDone[k] + '</span>';
          }).join('') + '</div>';
      }
      if (r.reviews.length) {
        body += '<h3 style="margin:16px 0 6px;font-size:13px">New reviews</h3>' +
          r.reviews.map(function (v) {
            return '<div class="alert ' + (v.stars >= 4 ? 'good' : v.stars <= 2 ? 'bad' : '') + '">' +
              '<span class="stars">' + stars(v.stars) + '</span> ' + v.stars.toFixed(1) +
              ' — ' + esc(v.customer) + '</div>';
          }).join('');
      }
    }
    r.events.forEach(function (e) {
      body += '<div class="alert info"><b>' + esc(e.name) + '</b><br>' + esc(e.text) + '</div>';
    });
    r.notes.forEach(function (n) {
      body += '<div class="alert">' + esc(n) + '</div>';
    });

    showModal('Day ' + r.day + ' — ' + r.cal.label, body,
      '<button class="btn primary" data-act="closemodal">Continue</button>');
  }

  function showModal(title, body, foot, dismissible) {
    UI.modal = { title: title, body: body, foot: foot };
    var el = document.getElementById('modal');
    el.innerHTML = '<div class="scrim"><div class="modal">' +
      '<div class="head"><h2>' + title + '</h2>' +
      (dismissible === false ? '' : '<button class="btn sm ghost" data-act="closemodal">✕</button>') + '</div>' +
      '<div class="body">' + body + '</div>' +
      (foot ? '<div class="foot">' + foot + '</div>' : '') +
      '</div></div>';
    el.style.display = 'block';
  }
  function closeModal() {
    UI.modal = null;
    var el = document.getElementById('modal');
    el.style.display = 'none';
    el.innerHTML = '';
  }

  function choiceModal() {
    var c = UI.state.pendingChoice;
    if (!c) return;
    showModal(c.name,
      '<p>' + esc(c.text) + '</p>',
      c.options.map(function (o) {
        return '<button class="btn" style="margin-left:8px" data-act="choice" data-key="' + o.key + '">' +
          esc(o.label) + '</button>';
      }).join(''), false);
  }

  function helpModal() {
    showModal('How To Run This Shop',
      '<p><b>The loop.</b> Each morning you set prices, fund advertising, order parts, schedule ' +
      'technicians, and decide what to build or who to train. Then you open the doors and the day runs.</p>' +
      '<p><b>The funnel.</b> Advertising and reputation produce <i>opportunities</i>. Your service ' +
      'advisors can only handle so many per day — the rest go to voicemail. Of the ones they handle, a ' +
      'percentage <i>close</i>, based on advisor training, your price against the market, and your ' +
      'rating. Closed work needs a parking space, a bay with the right tooling, a technician with the ' +
      'right skill and certification, and the parts on the shelf. Miss any one of those and the sale ' +
      'evaporates or the car sits.</p>' +
      '<p><b>The four levers.</b><br>' +
      '<b>Bays &amp; tooling</b> decide what work you can take and how fast it moves.<br>' +
      '<b>Technicians &amp; training</b> decide how many book hours you produce per clock hour, and how ' +
      'often a car comes back.<br>' +
      '<b>Advisors &amp; sales training</b> decide how many callers get helped and how much of what you ' +
      'find actually gets sold.<br>' +
      '<b>Advertising &amp; price</b> decide how many cars show up and what each one is worth.</p>' +
      '<p><b>Watch for.</b> Selling more work than you can produce fills your lot, stretches turnaround, ' +
      'and tanks your rating. Running out of parts forces hot-shot buying at a 55% premium. Cheap parts ' +
      'and green technicians produce comebacks, which are free labor you already paid for.</p>' +
      '<p><b>Cash.</b> A ' + money(D.FINANCE.creditLimit) + ' line of credit covers shortfalls ' +
      'automatically. Run out of both cash and credit and the game ends.</p>',
      '<button class="btn primary" data-act="closemodal">Got it</button>');
  }

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  function render() { root.AutoShopScreens.render(); }

  /* Live-updating a slider should not blow away the field you are dragging. */
  function softRefresh() {
    document.getElementById('header').innerHTML = renderHeader(UI.office);
  }

  /* ---------------------------------------------------------------- *
   * Actions
   * ---------------------------------------------------------------- */
  function autoOrder(days) {
    var s = UI.state;
    E.suggestOrder(s, days || 7).forEach(function (row) {
      if (row.order > 0) E.orderParts(s, row.cat, row.order);
    });
  }

  function runDays(n) {
    var s = UI.state;
    if (s.pendingChoice) { choiceModal(); return; }
    if (s.gameOver) { render(); return; }
    var last = null;
    for (var i = 0; i < n; i++) {
      if (s.gameOver || s.pendingChoice) break;
      if (n > 1) autoOrder(7);
      last = E.runDay(s);
      if (s.pendingChoice) break;
    }
    UI.lastResult = last || UI.lastResult;
    if (s.pendingChoice) { render(); choiceModal(); }
    else {
      render();
      if (last) toast('Ran ' + n + ' day(s). Cash ' + money(s.cash) + '.');
    }
    save(true);
  }

  var ACTIONS = {
    closemodal: function () { closeModal(); render(); },
    help: function () { helpModal(); },
    choice: function (el) {
      E.resolveChoice(UI.state, el.getAttribute('data-key'));
      closeModal(); render();
    },
    orderrec: function () {
      var r = root.AutoShopAdvice.parts(UI.state, 7), ok = 0, fail = null;
      r.rows.forEach(function (row) {
        if (row.order <= 0) return;
        var res = E.orderParts(UI.state, row.cat, row.order);
        if (res.ok) ok++; else fail = res.msg;
      });
      render();
      toast(fail || ('Ordered ' + ok + ' line(s) for ' + money(r.total) + '.'), !!fail);
    },
    order: function (el) {
      var cat = el.getAttribute('data-cat');
      var input = document.querySelector('[data-role="qty"][data-cat="' + cat + '"]');
      result(E.orderParts(UI.state, cat, input ? input.value : 0));
    },
    orderall: function () {
      var s = UI.state, ok = 0, fail = null;
      document.querySelectorAll('[data-role="qty"]').forEach(function (input) {
        var qty = parseInt(input.value, 10) || 0;
        if (qty <= 0) return;
        var r = E.orderParts(s, input.getAttribute('data-cat'), qty);
        if (r.ok) ok++; else fail = r.msg;
      });
      render();
      toast(fail || ('Placed ' + ok + ' order(s).'), !!fail);
    },
    supplier: function (el) { UI.state.supplier = el.value; render(); },
    program: function (el) { UI.state.orderProgram = el.value; render(); },
    hotshot: function () { UI.state.autoHotshot = !UI.state.autoHotshot; render(); },
    buildbay: function (el) { result(E.buildBay(UI.state, el.getAttribute('data-type'))); },
    tools: function (el) { result(E.upgradeTools(UI.state, el.getAttribute('data-id'))); },
    upgrade: function (el) { result(E.buyUpgrade(UI.state, el.getAttribute('data-key'))); },
    train: function (el) {
      var id = el.getAttribute('data-id');
      var sel = document.querySelector('[data-role="course"][data-id="' + id + '"]');
      result(E.trainTech(UI.state, id, sel ? sel.value : ''));
    },
    advtrain: function (el) {
      result(E.trainAdvisor(UI.state, el.getAttribute('data-id'), el.getAttribute('data-track')));
    },
    hire: function (el) { result(E.hire(UI.state, el.getAttribute('data-id'))); },
    fire: function (el) { result(E.fire(UI.state, el.getAttribute('data-id'))); },
    refreshpool: function () { result(E.refreshHiringPool(UI.state, false)); },
    borrow: function () {
      var v = document.querySelector('[data-role="borrow"]');
      result(E.borrow(UI.state, v ? v.value : 0));
    },
    repay: function () {
      var v = document.querySelector('[data-role="repay"]');
      result(E.repay(UI.state, v ? v.value : 0));
    },
    save: function () { save(); toast('Game saved.'); },
    load: function () { load(); },
    newgame: function () {
      if (!confirm('Start a new shop? Your current game will be replaced.')) return;
      UI.state = E.newGame();
      UI.lastResult = null;
      closeModal();
      render();
    }
  };

  function onClick(ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    if (ACTIONS[act]) { ev.preventDefault(); ACTIONS[act](el); }
  }

  function onInput(ev) {
    var el = ev.target;
    var act = el.getAttribute && el.getAttribute('data-act');
    if (!act) return;
    if (act === 'price') {
      E.setPrice(UI.state, el.getAttribute('data-key'), el.value);
      syncLabel(el, el.getAttribute('data-key'));
      softRefresh();
    } else if (act === 'ad') {
      E.setAdSpend(UI.state, el.getAttribute('data-key'), el.value);
      syncLabel(el);
      softRefresh();
    } else if (act === 'schedule') {
      E.setSchedule(UI.state, el.getAttribute('data-id'), el.value);
      syncLabel(el);
      softRefresh();
    }
  }

  function syncLabel(el, key) {
    var field = el.closest('label.field');
    if (!field) return;
    var b = field.querySelector('.lab b');
    if (b) {
      var v = Number(el.value);
      if (key === 'partsMarkup') b.textContent = v.toFixed(2) + '×';
      else if (key === 'coupon') b.textContent = v + '% off';
      else if (key === 'laborRate') b.textContent = money(v) + '/hr';
      else if (key === 'diagFee') b.textContent = money(v);
      else if (el.getAttribute('data-act') === 'schedule') b.textContent = v + 'h';
      else b.textContent = money(v);
    }
    // keep paired range + number inputs in step
    field.querySelectorAll('input[data-act]').forEach(function (other) {
      if (other !== el) other.value = el.value;
    });
  }

  function onChange(ev) {
    var el = ev.target;
    var act = el.getAttribute && el.getAttribute('data-act');
    if (act === 'supplier' || act === 'program') ACTIONS[act](el);
    else if (act === 'price' || act === 'ad' || act === 'schedule') { onInput(ev); render(); }
  }

  /* ---------------------------------------------------------------- *
   * Persistence
   * ---------------------------------------------------------------- */
  var KEY = 'torque-and-turnover-save';
  function save(quiet) {
    try {
      localStorage.setItem(KEY, E.serialize(UI.state));
    } catch (e) {
      if (!quiet) toast('Could not save: ' + e.message, true);
    }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) { toast('No saved game found.', true); return; }
      UI.state = E.deserialize(raw);
      UI.lastResult = null;
      closeModal();
      render();
      toast('Loaded day ' + UI.state.day + '.');
    } catch (e) { toast('Could not load save.', true); }
  }

  function boot() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    if (raw) {
      try { UI.state = E.deserialize(raw); } catch (e) { UI.state = E.newGame(); }
    } else {
      UI.state = E.newGame();
    }
    // Saves from before the day was split into three acts land on the morning.
    if (!UI.state.phase) UI.state.phase = 'morning';
    if (UI.state.step === undefined) UI.state.step = 0;
    if (UI.state.phase === 'day') UI.state.phase = 'morning';

    root.AutoShopScreens.attach(UI);
    root.AutoShopScreens.registerActions(ACTIONS);

    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    window.addEventListener('beforeunload', function () { save(true); });
    render();
    if (!raw) helpModal();
  }

  UI.h = {
    esc: esc, money: money, money2: money2, pct: pct, num: num, stars: stars,
    pips: pips, bar: bar, tile: tile, spark: spark, plTable: plTable
  };
  UI.tabs = {
    dash: tabDash, floor: tabFloor, crew: tabCrew, parts: tabParts,
    price: tabPrice, marketing: tabMarketing, upgrades: tabUpgrades, books: tabBooks
  };
  UI.ACTIONS = ACTIONS;
  UI.renderHeader = renderHeader;
  UI.railLog = railLog;
  UI.showModal = showModal;
  UI.closeModal = closeModal;
  UI.choiceModal = choiceModal;
  UI.helpModal = helpModal;
  UI.toast = toast;
  UI.save = save;
  UI.runDays = runDays;
  UI.office = null;
  UI.play = null;
  UI.adLevel = 'standard';

  root.AutoShopUI = UI;
  UI.boot = boot;
  UI.render = render;
})(window);
